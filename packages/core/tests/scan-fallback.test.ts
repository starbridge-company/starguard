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
    expect(fonte).toContain("cpus().length");
  });
});
