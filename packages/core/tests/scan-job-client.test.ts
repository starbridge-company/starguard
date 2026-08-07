// ============================================================
// O cliente do scan como JOB — AUDITORIA.md#ARQ-16.
//
// Antes, uma requisição só carregava tudo: subia os megabytes, esperava o
// scanner e trazia os achados. Com um teto de 90 s do lado de cá e um SAST de
// minutos do lado de lá, o desfecho normal virou "abortar e tentar de novo" —
// e cada abandono deixava um scan órfão rodando no servidor.
//
// Aqui se prova o desenho que substituiu aquilo:
//
//   envia -> recebe um `jobId` -> pergunta o estado até terminar
//
// Os testes que mais importam não são os do caso feliz: são os de CANCELAR (que
// precisa avisar o servidor) e os de FALHA DE CONSULTA (que não pode jogar fora
// dez minutos de trabalho por causa de um pacote perdido).
// ============================================================
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  RemoteScanError,
  callRemoteScan,
  esquecerLimites,
  limitesDoServidor,
  podeCairParaLocal,
  setScanTransport,
} from "../src/scan-transport";

const original = globalThis.fetch;

const t = {
  kind: "remote" as const,
  baseUrl: "https://exemplo.invalido",
  getToken: async () => "tok",
};

beforeEach(() => {
  esquecerLimites();
  // O que se mede aqui é o PROTOCOLO, não a paciência de quem roda a suíte. O
  // ritmo real (1 s crescendo até 5 s) é escolha de produto e está documentado
  // onde é decidido; aqui ele só precisa existir.
  process.env.SCAN_POLL_INTERVAL_MS = "5";
  process.env.SCAN_POLL_MAX_MS = "5";
});
afterEach(() => {
  globalThis.fetch = original;
  setScanTransport({ kind: "local" });
  esquecerLimites();
  delete process.env.SCAN_POLL_INTERVAL_MS;
  delete process.env.SCAN_POLL_MAX_MS;
});

interface Chamada {
  metodo: string;
  url: string;
}

/**
 * Um servidor de mentira que fala o protocolo de job.
 *
 * `estados` é a sequência de respostas do `GET`, uma por consulta. Devolve o
 * registro das chamadas para que os testes possam afirmar o que foi PEDIDO —
 * é assim que se prova que o `DELETE` do cancelamento realmente saiu.
 */
function servidorDeJob(estados: Record<string, unknown>[]): Chamada[] {
  const chamadas: Chamada[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string, init: { method: string }) => {
    chamadas.push({ metodo: init.method, url: String(url) });
    const json = (corpo: unknown, status = 200) =>
      new Response(JSON.stringify(corpo), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (init.method === "POST") return json({ jobId: "j-1", position: 2 }, 202);
    if (init.method === "DELETE") return json({ status: "cancelled" });
    // GET sem `job=` é a consulta de limites.
    if (!String(url).includes("job=")) return json({ maxFiles: 800, maxBytes: 123 });
    const estado = estados[Math.min(i++, estados.length - 1)]!;
    return json(estado);
  }) as unknown as typeof globalThis.fetch;
  return chamadas;
}

const arquivos = [{ path: "a.ts", content: "x" }];

describe("o caminho normal: aceita, acompanha, entrega", () => {
  it("o resultado vem da consulta, não da resposta do envio", async () => {
    servidorDeJob([
      { status: "queued", position: 1 },
      { status: "running" },
      { status: "done", result: [{ id: "V-1" }] },
    ]);

    const r = await callRemoteScan(t, { analyzer: "sast", files: arquivos, locale: "pt-BR" });
    expect(r).toEqual([{ id: "V-1" }]);
  });

  it("a espera é CONTADA na tela, com a posição", async () => {
    // Uma barra sem número é indistinguível de uma barra travada — foi
    // exatamente essa a impressão que a extensão dava.
    servidorDeJob([
      { status: "queued", position: 3 },
      { status: "done", result: [] },
    ]);

    // Os valores são NOMEADOS, e não posicionais: a ordem das palavras muda
    // entre os três idiomas, então a frase interpola `{n}`, não "o primeiro
    // argumento". Ver `RemoteScanInput.report`.
    const avisos: [string, Record<string, string | number> | undefined][] = [];
    await callRemoteScan(t, {
      analyzer: "sast",
      files: arquivos,
      locale: "pt-BR",
      report: (chave, valores) => avisos.push([chave, valores]),
    });

    expect(avisos).toContainEqual(["scan.queuedAt", { n: 2 }]); // a do 202
    expect(avisos).toContainEqual(["scan.queuedAt", { n: 3 }]); // a da consulta
  });

  it("o mesmo aviso não é repetido a cada consulta", async () => {
    // Repetir "na fila (2º)" de segundo em segundo transforma informação em
    // ruído, e ruído treina as pessoas a não ler o aviso que importa.
    servidorDeJob([
      { status: "running" },
      { status: "running" },
      { status: "running" },
      { status: "done", result: [] },
    ]);

    const avisos: string[] = [];
    await callRemoteScan(t, {
      analyzer: "sca",
      files: arquivos,
      locale: "pt-BR",
      report: (chave) => avisos.push(chave),
    });

    expect(avisos.filter((a) => a === "scan.scanning")).toHaveLength(1);
  });
});

describe("cancelar avisa o SERVIDOR (era só um `fetch` abortado)", () => {
  it("o DELETE sai, e é o que libera a vaga do outro lado", async () => {
    const chamadas = servidorDeJob([{ status: "running" }]);
    const ctrl = new AbortController();

    const promessa = callRemoteScan(t, {
      analyzer: "sast",
      files: arquivos,
      locale: "pt-BR",
      signal: ctrl.signal,
    }).catch((e: RemoteScanError) => e);

    // Depois do envio e já dentro do acompanhamento.
    await new Promise((r) => setTimeout(r, 30));
    ctrl.abort();
    const erro = (await promessa) as RemoteScanError;

    expect(erro).toBeInstanceOf(RemoteScanError);
    expect(chamadas.some((c) => c.metodo === "DELETE" && c.url.includes("job=j-1"))).toBe(true);
  });

  it("cancelar NÃO autoriza rodar localmente", async () => {
    // Este era um defeito silencioso: o cancelamento viajava como `unreachable`,
    // e `unreachable` autoriza o socorro local. Clicar em Cancelar interrompia o
    // scan do servidor para começar um scan local, do zero, na máquina de quem
    // acabara de pedir para parar.
    servidorDeJob([{ status: "running" }]);
    const ctrl = new AbortController();

    const promessa = callRemoteScan(t, {
      analyzer: "sast",
      files: arquivos,
      locale: "pt-BR",
      signal: ctrl.signal,
    }).catch((e: RemoteScanError) => e);

    await new Promise((r) => setTimeout(r, 30));
    ctrl.abort();
    const erro = (await promessa) as RemoteScanError;

    expect(erro.code).toBe("cancelled");
    expect(podeCairParaLocal(erro)).toBe(false);
  });
});

describe("o que o servidor responde vira o desfecho certo", () => {
  it("binário ausente lá é `unavailable` — e autoriza rodar aqui", async () => {
    servidorDeJob([{ status: "error", error: "opengrep não encontrado", unavailable: true }]);
    const erro = await callRemoteScan(t, {
      analyzer: "sast",
      files: arquivos,
      locale: "pt-BR",
    }).catch((e: RemoteScanError) => e);

    expect((erro as RemoteScanError).code).toBe("unavailable");
    expect(podeCairParaLocal(erro)).toBe(true);
  });

  it("falha do scanner é `failed` — não adianta repetir aqui", async () => {
    servidorDeJob([{ status: "error", error: "regra inválida" }]);
    const erro = await callRemoteScan(t, {
      analyzer: "sast",
      files: arquivos,
      locale: "pt-BR",
    }).catch((e: RemoteScanError) => e);

    expect((erro as RemoteScanError).code).toBe("failed");
    expect((erro as Error).message).toContain("regra inválida");
  });

  it("job desconhecido (o servidor reiniciou) é `unreachable`, e cai para o local", async () => {
    // Não é recusa: o trabalho simplesmente não existe mais. Tratar como falha
    // definitiva deixaria a pessoa sem análise com o opengrep instalado ao lado.
    let primeira = true;
    globalThis.fetch = (async (url: string, init: { method: string }) => {
      const json = (c: unknown, s = 200) =>
        new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
      if (init.method === "POST") return json({ jobId: "j-1" }, 202);
      if (!String(url).includes("job=")) return json({ maxFiles: 800, maxBytes: 1 });
      if (primeira) {
        primeira = false;
        return json({ status: "running" });
      }
      return json({ error: "Scan não encontrado." }, 404);
    }) as unknown as typeof globalThis.fetch;

    const erro = await callRemoteScan(t, {
      analyzer: "sast",
      files: arquivos,
      locale: "pt-BR",
    }).catch((e: RemoteScanError) => e);

    expect((erro as RemoteScanError).code).toBe("unreachable");
    expect(podeCairParaLocal(erro)).toBe(true);
  });
});

describe("uma consulta perdida não joga fora o scan", () => {
  it("tolera falhas seguidas e segue quando o servidor volta", async () => {
    // O servidor do MVP hiberna e reinicia. Um pacote perdido no meio de um scan
    // que está indo bem não é motivo para descartar minutos de trabalho.
    let n = 0;
    globalThis.fetch = (async (url: string, init: { method: string }) => {
      const json = (c: unknown, s = 200) =>
        new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
      if (init.method === "POST") return json({ jobId: "j-1" }, 202);
      if (!String(url).includes("job=")) return json({ maxFiles: 800, maxBytes: 1 });
      n++;
      if (n <= 2) throw new Error("socket hang up");
      return json({ status: "done", result: [{ id: "V" }] });
    }) as unknown as typeof globalThis.fetch;

    const r = await callRemoteScan(t, { analyzer: "sca", files: arquivos, locale: "pt-BR" });
    expect(r).toEqual([{ id: "V" }]);
    expect(n).toBeGreaterThan(2);
  });

  it("mas desiste quando elas não param, e aí é `unreachable`", async () => {
    globalThis.fetch = (async (url: string, init: { method: string }) => {
      if (init.method === "POST") {
        return new Response(JSON.stringify({ jobId: "j-1" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
      if (!String(url).includes("job=")) {
        return new Response(JSON.stringify({ maxFiles: 800, maxBytes: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("ENOTFOUND");
    }) as unknown as typeof globalThis.fetch;

    const erro = await callRemoteScan(t, {
      analyzer: "sca",
      files: arquivos,
      locale: "pt-BR",
    }).catch((e: RemoteScanError) => e);

    expect((erro as RemoteScanError).code).toBe("unreachable");
    expect(podeCairParaLocal(erro)).toBe(true);
  });
});

describe("servidor da geração anterior continua funcionando", () => {
  it("200 com `result` é aceito como resposta completa", async () => {
    // Durante uma implantação as duas gerações convivem. Exigir versões casadas
    // abriria uma janela em que ninguém consegue analisar nada.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ result: [{ id: "V-antigo" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch;

    const r = await callRemoteScan(t, { analyzer: "sca", files: arquivos, locale: "pt-BR" });
    expect(r).toEqual([{ id: "V-antigo" }]);
  });
});

describe("os tetos vêm do servidor, não de um palpite", () => {
  it("são lidos do `GET /api/scan` e memorizados", async () => {
    // O cliente empacotava 12 MB / 1200 arquivos contra 8 MB / 800 do servidor.
    // Todo projeto médio levava 413 na primeira tentativa e era escaneado duas
    // vezes, cada uma carregando o ruleset inteiro do opengrep.
    let consultas = 0;
    globalThis.fetch = (async () => {
      consultas++;
      return new Response(JSON.stringify({ maxFiles: 42, maxBytes: 4242 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    expect(await limitesDoServidor(t)).toEqual({ maxFiles: 42, maxBytes: 4242 });
    expect(await limitesDoServidor(t)).toEqual({ maxFiles: 42, maxBytes: 4242 });
    expect(consultas).toBe(1);
  });

  it("servidor que não sabe responder não impede o scan", async () => {
    globalThis.fetch = (async () =>
      new Response("nao existe", { status: 404 })) as unknown as typeof globalThis.fetch;

    const limites = await limitesDoServidor(t);
    // O padrão é o MESMO da rota. Se um dia divergirem, a pergunta corrige.
    expect(limites.maxFiles).toBe(800);
    expect(limites.maxBytes).toBe(8 * 1024 * 1024);
  });
});
