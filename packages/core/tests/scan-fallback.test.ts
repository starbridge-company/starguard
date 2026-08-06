// ============================================================
// Quando o servidor não responde, a análise ACONTECE.
//
// Relatado numa frase: "deu fetch failed, continua não fazendo a análise".
//
// Duas coisas estavam erradas, e a segunda é a grave.
//
// **A mensagem.** `fetch` do Node devolve SEMPRE a mesma frase — "fetch
// failed" — e guarda a informação de verdade em `cause`. O transporte
// repassava só a mensagem, então servidor dormindo, DNS errado, proxy no
// caminho e certificado vencido produziam exatamente o mesmo texto na tela.
// Quatro problemas, quatro soluções diferentes, uma frase só.
//
// **O desfecho.** Falha de rede derrubava o analisador inteiro — com o
// `opengrep` instalado na máquina, parado, sem ser chamado. Não analisar nada
// é o pior desfecho possível para uma ferramenta de segurança, e é pior que
// analisar mais devagar.
// ============================================================
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  RemoteScanError,
  podeCairParaLocal,
  setScanTransport,
  usingRemoteScan,
} from "../src/scan-transport";
import { comSocorroLocal } from "../src/binaries";

afterEach(() => setScanTransport({ kind: "local" }));

describe("cair para o local (o socorro do «fetch failed»)", () => {
  const rede = new RemoteScanError("Não foi possível falar com o servidor: ENOTFOUND", "unreachable");

  it("falha de REDE autoriza rodar aqui", () => {
    expect(podeCairParaLocal(rede)).toBe(true);
    expect(podeCairParaLocal(new RemoteScanError("sem binário lá", "unavailable"))).toBe(true);
  });

  it("sessão expirada NÃO autoriza — é problema a resolver, não a contornar", () => {
    // Contornar esconderia justamente o que a pessoa precisa consertar.
    expect(podeCairParaLocal(new RemoteScanError("expirou", "unauthorized"))).toBe(false);
  });

  it("projeto grande demais NÃO autoriza — continuaria grande aqui", () => {
    expect(podeCairParaLocal(new RemoteScanError("grande", "too_large"))).toBe(false);
  });

  it("erro que não é do transporte não autoriza nada", () => {
    expect(podeCairParaLocal(new Error("qualquer outra coisa"))).toBe(false);
  });

  it("com o binário presente, o trabalho é feito localmente", async () => {
    const relatado: string[] = [];
    const r = await comSocorroLocal(
      () => Promise.reject(rede),
      () => Promise.resolve(["achado local"]),
      // `node` existe em qualquer máquina que rode esta suíte — é o binário
      // mais honesto para provar o caminho sem depender do opengrep.
      "node",
      { locale: "pt-BR", report: (m) => relatado.push(m) }
    );
    expect(r).toEqual(["achado local"]);
  });

  it("a troca é DECLARADA, com o motivo junto", async () => {
    // Mudar em silêncio o lugar onde o código é processado é o tipo de decisão
    // que este produto não toma pelas costas de ninguém.
    const relatado: string[] = [];
    await comSocorroLocal(
      () => Promise.reject(rede),
      () => Promise.resolve([]),
      "node",
      { locale: "pt-BR", report: (m) => relatado.push(m) }
    );
    expect(relatado.join(" | ")).toContain("servidor não respondeu");
    expect(relatado.join(" | ")).toContain("ENOTFOUND");
  });

  it("sem binário local, o erro do servidor é o que a pessoa vê", async () => {
    // Não há nada a fazer aqui: inventar um desfecho seria pior que o erro.
    await expect(
      comSocorroLocal(
        () => Promise.reject(rede),
        () => Promise.resolve([]),
        "binario-que-nao-existe-mesmo-starguard",
        { locale: "pt-BR" }
      )
    ).rejects.toThrow("ENOTFOUND");
  });

  it("sessão expirada sobe, mesmo com binário à mão", async () => {
    await expect(
      comSocorroLocal(
        () => Promise.reject(new RemoteScanError("expirou", "unauthorized")),
        () => Promise.resolve(["local"]),
        "node",
        { locale: "pt-BR" }
      )
    ).rejects.toThrow("expirou");
  });

  it("o remoto que dá certo não chama o local", async () => {
    let chamou = false;
    const r = await comSocorroLocal(
      () => Promise.resolve(["do servidor"]),
      () => {
        chamou = true;
        return Promise.resolve(["local"]);
      },
      "node",
      { locale: "pt-BR" }
    );
    expect(r).toEqual(["do servidor"]);
    expect(chamou).toBe(false);
  });
});

describe("a mensagem de rede diz o que houve", () => {
  it("`fetch failed` sozinho não chega à tela", async () => {
    // O que o Node entrega é sempre "fetch failed"; a causa (ENOTFOUND, porta
    // inválida, certificado) está em `cause`. Este teste usa um host que não
    // resolve para provar que a causa REAL atravessa o transporte.
    setScanTransport({
      kind: "remote",
      baseUrl: "https://nao-existe-mesmo-starguard.invalid",
      getToken: async () => "token",
    });
    expect(usingRemoteScan()).toBe(true);

    const { callRemoteScan, getScanTransport } = await import("../src/scan-transport");
    const t = getScanTransport();
    if (t.kind !== "remote") throw new Error("transporte errado");

    const erro = await callRemoteScan(t, {
      analyzer: "sca",
      files: [],
      locale: "pt-BR",
    }).catch((e: Error) => e);

    expect(erro).toBeInstanceOf(RemoteScanError);
    expect((erro as RemoteScanError).code).toBe("unreachable");
    // A URL, para saber PARA ONDE não deu; e a causa, para saber POR QUÊ.
    expect((erro as Error).message).toContain("nao-existe-mesmo-starguard.invalid");
    expect((erro as Error).message).not.toMatch(/fetch failed$/);
  }, 30_000);
});

// ============================================================
// O SAST tem que TERMINAR.
//
// `--timeout 0` não quer dizer "rápido" nem "padrão": quer dizer **sem limite
// algum**. Uma combinação patológica de regra e arquivo — expressão regular
// que explode, arquivo gerado com uma linha de 200 kB — segura o processo pelo
// tempo que precisar. No servidor isso vira uma requisição que nunca volta, e
// foi o `timeout` que a extensão relatou.
// ============================================================
describe("argumentos do SAST", () => {
  const fonte = readFileSync(
    new URL("../src/analyzers/sast.ts", import.meta.url),
    "utf8"
  );

  it("não roda mais SEM limite de tempo por regra", () => {
    expect(fonte).not.toContain('"--timeout", "0"');
  });

  it("o teto padrão é o do próprio Semgrep, e é configurável", () => {
    // 5 s por regra e por arquivo. Quem preferir esperar mais sobe o env em vez
    // de editar código.
    expect(fonte).toContain("SAST_RULE_TIMEOUT ?? 5");
  });

  it("o paralelismo é EXPLÍCITO", () => {
    // O padrão varia entre compilações do Opengrep, e uma que caia para 1
    // processo transforma um scan de um minuto num de dez.
    expect(fonte).toContain('"--jobs"');
  });

  it("…e sai do CONTÊINER, não de `os.cpus()` — AUDITORIA.md#ARQ-15", () => {
    // Era `cpus().length`, que dentro de um contêiner conta os núcleos do
    // HOSPEDEIRO: oito processos do opengrep numa instância de meia CPU e
    // 512 MB. A memória estourava e a instância morria no meio da requisição —
    // o editor recebia 403 e 502 de páginas de erro, sem corpo JSON.
    expect(fonte).toContain("sastJobs()");
    expect(fonte).not.toContain("cpus().length");
  });

  it("o teto de memória por processo é passado quando a caixa tem limite", () => {
    expect(fonte).toContain("--max-memory");
  });
});

describe("403 sem autor não chega mais à tela (UX-27)", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    setScanTransport({ kind: "local" });
  });

  const transporte = {
    kind: "remote" as const,
    baseUrl: "https://exemplo.invalido",
    getToken: async () => "tok",
  };

  const responder = (status: number, corpo: string, headers: Record<string, string>) => {
    globalThis.fetch = (async () =>
      new Response(corpo, { status, headers })) as typeof globalThis.fetch;
  };

  const chamar = async () => {
    const { callRemoteScan } = await import("../src/scan-transport");
    return callRemoteScan(transporte, { analyzer: "sast", files: [], locale: "pt-BR" });
  };

  it("recusa NOSSA continua mostrando o texto do servidor", async () => {
    responder(403, JSON.stringify({ error: "Esta rota aceita apenas token de aplicativo." }), {
      "content-type": "application/json",
    });
    await expect(chamar()).rejects.toThrow("Esta rota aceita apenas token de aplicativo.");
  });

  it("recusa de INTERMEDIÁRIO diz quem foi", async () => {
    // Era aqui que a tela mostrava só "Falha no scan remoto (403)": um número
    // sem autor, que não distingue o StarGuard recusando de uma CDN no meio.
    responder(403, "<!DOCTYPE html><html><body>Attention Required! Cloudflare</body></html>", {
      "content-type": "text/html; charset=UTF-8",
      "cf-ray": "abc123-GRU",
    });
    const erro = await chamar().catch((e) => e as Error);
    expect(erro.message).toContain("403");
    expect(erro.message).toContain("text/html");
    expect(erro.message).toContain("cf-ray abc123-GRU");
    expect(erro.message).toContain("Cloudflare");
  });

  it("a pista é CURTA — vai para uma notificação, não para um relatório", async () => {
    responder(403, "x".repeat(5000), { "content-type": "text/html" });
    const erro = await chamar().catch((e) => e as Error);
    expect(erro.message.length).toBeLessThan(300);
  });

  it("recusa de intermediário AUTORIZA o socorro local", async () => {
    // Com o opengrep instalado a um palmo, deixar de analisar por causa de um
    // 403 de CDN é o pior desfecho possível — e o pedido nunca chegou ao app.
    //
    // O código é `blocked`, e não mais `unreachable`. A distinção nasceu de um
    // defeito medido: com o servidor FORA DO AR, `unreachable` autorizava
    // `callRemoteScanPartido` a dividir o pacote, e 800 arquivos desciam sete
    // níveis de divisão repagando o teto de envio a cada um — vinte e oito
    // minutos para concluir que o DNS não resolvia. Dividir só faz sentido
    // quando ALGUÉM respondeu recusando; metade de um pacote não chega mais
    // perto de um servidor que não atende. Ver AUDITORIA.md#ARQ-17.
    responder(403, "<html>Cloudflare</html>", { "content-type": "text/html" });
    const erro = await chamar().catch((e) => e as RemoteScanError);
    expect(erro.code).toBe("blocked");
    // O que importava neste teste continua valendo: a análise acontece.
    expect(podeCairParaLocal(erro)).toBe(true);
  });

  it("recusa NOSSA não autoriza — é permissão a resolver", async () => {
    responder(403, JSON.stringify({ error: "Acesso restrito." }), {
      "content-type": "application/json",
    });
    const erro = await chamar().catch((e) => e as RemoteScanError);
    expect(erro.code).toBe("failed");
    expect(podeCairParaLocal(erro)).toBe(false);
  });

  it("corpo vazio não inventa pista", async () => {
    responder(500, "", {});
    const erro = await chamar().catch((e) => e as Error);
    expect(erro.message).toContain("500");
  });
});

describe("pacote recusado inteiro é reenviado em PARTES (UX-27)", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    setScanTransport({ kind: "local" });
  });

  const transporte = {
    kind: "remote" as const,
    baseUrl: "https://exemplo.invalido",
    getToken: async () => "tok",
  };

  const arquivos = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: `a${i}.ts`, content: "x" }));

  const partido = async (files: { path: string; content: string }[]) => {
    const { callRemoteScanPartido } = await import("../src/scan-transport");
    return callRemoteScanPartido(transporte, { analyzer: "sast", files, locale: "pt-BR" });
  };

  /** Recusa sem corpo nosso (a CDN) acima de `teto` arquivos; abaixo, responde. */
  function servidorQueRecusaPacoteGrande(teto: number, chamadas: number[]) {
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const n = (JSON.parse(init.body) as { files: unknown[] }).files.length;
      chamadas.push(n);
      if (n > teto) {
        return new Response("<html>Blocked</html>", {
          status: 403,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(
        JSON.stringify({ result: Array.from({ length: n }, (_, i) => ({ id: `V-${i}` })) }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof globalThis.fetch;
  }

  it("divide até passar e devolve TODOS os achados", async () => {
    const chamadas: number[] = [];
    servidorQueRecusaPacoteGrande(2, chamadas);
    const r = (await partido(arquivos(8))) as unknown[];
    // 8 recusado, 4 e 4 recusados, quatro pacotes de 2 aceitos: nada se perde.
    expect(r).toHaveLength(8);
    expect(chamadas[0]).toBe(8);
    expect(chamadas.filter((n) => n === 2)).toHaveLength(4);
  });

  it("um arquivo só não tem como dividir — o erro sobe", async () => {
    const chamadas: number[] = [];
    servidorQueRecusaPacoteGrande(0, chamadas);
    await expect(partido(arquivos(1))).rejects.toThrow(RemoteScanError);
  });

  it("recusa NOSSA não divide — dividir multiplicaria a mesma falha", async () => {
    const chamadas: number[] = [];
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      chamadas.push((JSON.parse(init.body) as { files: unknown[] }).files.length);
      return new Response(JSON.stringify({ error: "Sessão expirada." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
    await expect(partido(arquivos(8))).rejects.toThrow("Sessão expirada.");
    expect(chamadas).toEqual([8]);
  });

  it("pacote que passa de primeira NÃO é dividido", async () => {
    const chamadas: number[] = [];
    servidorQueRecusaPacoteGrande(100, chamadas);
    await partido(arquivos(8));
    expect(chamadas).toEqual([8]);
  });
});

describe("a divisão é SEQUENCIAL (ARQ-15)", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    setScanTransport({ kind: "local" });
  });

  it("nunca há duas metades no ar ao mesmo tempo", async () => {
    // Paralelizar a divisão é o instinto errado: ela só acontece porque o
    // outro lado já não deu conta. Quando a causa é falta de memória no
    // servidor, cada rodada em paralelo (2, 4, 8) mantém a instância no chão.
    let emVoo = 0;
    let pico = 0;
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      const n = (JSON.parse(init.body) as { files: unknown[] }).files.length;
      emVoo--;
      if (n > 1) {
        return new Response("<html>morreu</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(JSON.stringify({ result: [{ id: "V" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const { callRemoteScanPartido } = await import("../src/scan-transport");
    const r = (await callRemoteScanPartido(
      { kind: "remote", baseUrl: "https://x.invalido", getToken: async () => "t" },
      {
        analyzer: "sast",
        files: Array.from({ length: 4 }, (_, i) => ({ path: `${i}.ts`, content: "x" })),
        locale: "pt-BR",
      }
    )) as unknown[];

    expect(r).toHaveLength(4);
    expect(pico).toBe(1);
  });
});

describe("fila do CLIENTE: marcar os dois e rodar junto continua valendo (ARQ-15)", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    setScanTransport({ kind: "local" });
  });

  const t = {
    kind: "remote" as const,
    baseUrl: "https://exemplo.invalido",
    getToken: async () => "tok",
  };

  it("os dois scans passam, um de cada vez, e ninguém é recusado", async () => {
    // O orquestrador dispara `sast` e `sca` em paralelo — isso não mudou. O
    // que mudou é que a conversa com o servidor é serializada AQUI, com aviso,
    // em vez de os dois scanners nativos se atropelarem lá.
    let emVoo = 0;
    let pico = 0;
    globalThis.fetch = (async () => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 10));
      emVoo--;
      return new Response(JSON.stringify({ result: [{ id: "V" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const { callRemoteScan } = await import("../src/scan-transport");
    const avisos: string[] = [];
    const [a, b] = await Promise.all([
      callRemoteScan(t, { analyzer: "sast", files: [], locale: "pt-BR" }),
      callRemoteScan(t, {
        analyzer: "sca",
        files: [],
        locale: "pt-BR",
        report: (m) => avisos.push(m),
      }),
    ]);

    // Nenhum perdido, nenhum erro.
    expect(a).toEqual([{ id: "V" }]);
    expect(b).toEqual([{ id: "V" }]);
    // E nunca dois no ar ao mesmo tempo.
    expect(pico).toBe(1);
  });

  it("quem espera é AVISADO — «na fila» é estado, não erro", async () => {
    globalThis.fetch = (async () => {
      await new Promise((r) => setTimeout(r, 15));
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const { callRemoteScan, MSG_NA_FILA } = await import("../src/scan-transport");
    const avisos: string[] = [];
    await Promise.all([
      callRemoteScan(t, { analyzer: "sast", files: [], locale: "pt-BR" }),
      callRemoteScan(t, {
        analyzer: "sca",
        files: [],
        locale: "pt-BR",
        report: (m) => avisos.push(m),
      }),
    ]);
    expect(avisos).toContain(MSG_NA_FILA);
  });

  it("o primeiro NÃO recebe aviso de fila — ele não esperou ninguém", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch;

    const { callRemoteScan } = await import("../src/scan-transport");
    const avisos: string[] = [];
    await callRemoteScan(t, {
      analyzer: "sast",
      files: [],
      locale: "pt-BR",
      report: (m) => avisos.push(m),
    });
    expect(avisos).toEqual([]);
  });

  it("scan que falha não trava a fila para o seguinte", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) throw new Error("caiu");
      return new Response(JSON.stringify({ result: [{ id: "V" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const { callRemoteScan } = await import("../src/scan-transport");
    const primeiro = callRemoteScan(t, { analyzer: "sast", files: [], locale: "pt-BR" }).catch(
      (e: Error) => e
    );
    const segundo = callRemoteScan(t, { analyzer: "sca", files: [], locale: "pt-BR" });
    await primeiro;
    await expect(segundo).resolves.toEqual([{ id: "V" }]);
  });
});
