// ============================================================
// Servidor fora do ar: a análise tem que ACONTECER, e rápido.
//
// Relatado assim: *"o sast está rodando há 17 minutos e nada ainda"*, e depois
// *"deu isso ainda depois de tanto tempo: Não foi possível falar com o servidor
// (…): ENOTFOUND"*. Vinte minutos de espera para, no fim, uma mensagem de rede.
//
// A aritmética do defeito, medida contra os tetos reais:
//
//   POST do pacote .................. 120 s, com UMA segunda tentativa = 240 s
//   `callRemoteScanPartido` divide ao levar `unreachable`
//   800 arquivos -> 400 -> 200 -> 100 -> 50 -> 25 -> 12 -> ... -> 1 = 7 níveis
//   ---------------------------------------------------------------
//   7 x 240 s = 28 minutos antes de sequer TENTAR o opengrep local
//
// A divisão em partes existe pelo `UX-27`: um intermediário (CDN, proxy de
// empresa, antivírus) recusa o pacote GRANDE e devolve uma página. Ali dividir
// resolve. Mas quando **ninguém respondeu** — DNS que não resolve, conexão
// recusada, tempo esgotado — o tamanho do pacote não tem nada a ver com a
// falha, e cada metade só repaga o mesmo teto de novo.
//
// Duas coisas consertam isso, e as duas estão aqui:
//
//   1. "não respondeu" e "respondeu recusando" viram códigos DIFERENTES, e só o
//      segundo autoriza dividir;
//   2. a requisição BARATA (os limites) vai na frente e serve de sonda — não se
//      sobem megabytes para um servidor que não atende.
// ============================================================
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  RemoteScanError,
  callRemoteScanPartido,
  esquecerLimites,
  podeCairParaLocal,
  servidorRespondeu,
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

const arquivos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ path: `a${i}.ts`, content: "x" }));

/** Nada atende: é o DNS que não resolve, a porta fechada, o tempo esgotado. */
function ninguemAtende(): { n: number } {
  const conta = { n: 0 };
  globalThis.fetch = (async () => {
    conta.n++;
    const e = new Error("fetch failed") as Error & { cause?: { code: string } };
    e.cause = { code: "ENOTFOUND" };
    throw e;
  }) as unknown as typeof globalThis.fetch;
  return conta;
}

describe("ninguém atende: NÃO se divide o pacote", () => {
  it("o pacote inteiro é tentado uma vez, e só", async () => {
    // Este é o teste que falha no desenho anterior: lá eram 7 níveis de divisão,
    // cada um repagando o teto de 120 s duas vezes. Vinte e oito minutos para
    // descobrir que o DNS não resolve.
    const conta = ninguemAtende();

    const erro = await callRemoteScanPartido(t, {
      analyzer: "sast",
      files: arquivos(800),
      locale: "pt-BR",
    }).catch((e: RemoteScanError) => e);

    expect((erro as RemoteScanError).code).toBe("unreachable");
    // Duas requisições: a primeira e a segunda tentativa. Nenhuma divisão.
    expect(conta.n).toBe(2);
  });

  it("e o erro autoriza rodar aqui — com o opengrep a um palmo", async () => {
    ninguemAtende();
    const erro = await callRemoteScanPartido(t, {
      analyzer: "sast",
      files: arquivos(64),
      locale: "pt-BR",
    }).catch((e: RemoteScanError) => e);

    expect(podeCairParaLocal(erro)).toBe(true);
  });
});

describe("alguém RESPONDEU recusando: aí sim se divide (UX-27)", () => {
  /** A CDN devolve uma página para o pacote grande e aceita o pequeno. */
  function cdnRecusaPacoteGrande(teto: number, chamadas: number[]) {
    globalThis.fetch = (async (_url: string, init: { method: string; body?: string }) => {
      if (init.method !== "POST") {
        return new Response(JSON.stringify({ maxFiles: 9999, maxBytes: 9e9 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const n = (JSON.parse(init.body!) as { files: unknown[] }).files.length;
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

  it("divide até passar e não perde achado", async () => {
    const chamadas: number[] = [];
    cdnRecusaPacoteGrande(2, chamadas);
    const r = (await callRemoteScanPartido(t, {
      analyzer: "sast",
      files: arquivos(8),
      locale: "pt-BR",
    })) as unknown[];

    expect(r).toHaveLength(8);
    expect(chamadas[0]).toBe(8);
    expect(chamadas.filter((n) => n === 2)).toHaveLength(4);
  });

  it("a recusa de intermediário é `blocked`, e também cai para o local", async () => {
    // Continua sendo "o pedido não chegou até nós", que é o que autoriza o
    // socorro. O que mudou é só que ela pode ser dividida, e a de rede não.
    const chamadas: number[] = [];
    cdnRecusaPacoteGrande(0, chamadas);
    const erro = await callRemoteScanPartido(t, {
      analyzer: "sast",
      files: arquivos(1),
      locale: "pt-BR",
    }).catch((e: RemoteScanError) => e);

    expect((erro as RemoteScanError).code).toBe("blocked");
    expect(podeCairParaLocal(erro)).toBe(true);
  });
});

describe("a sonda barata vai na frente do pacote pesado", () => {
  it("servidor mudo: nenhum byte de código é enviado", async () => {
    // Subir 8 MB para descobrir que o servidor não atende é pagar o preço caro
    // para obter a informação barata. A consulta de limites tem dezenas de bytes
    // e responde a mesma pergunta.
    const conta = ninguemAtende();
    expect(await servidorRespondeu(t)).toBe(false);
    expect(conta.n).toBe(1);
  });

  it("servidor de pé: a sonda passa e o scan segue", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ maxFiles: 800, maxBytes: 1024 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch;

    expect(await servidorRespondeu(t)).toBe(true);
  });

  it("401 na sonda é servidor DE PÉ — o problema é a sessão, não a rede", async () => {
    // Confundir os dois mandaria a pessoa investigar a rede por causa de um
    // login expirado. A sonda responde "atende?", não "me deixa entrar?".
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Não autenticado." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch;

    expect(await servidorRespondeu(t)).toBe(true);
  });
});
