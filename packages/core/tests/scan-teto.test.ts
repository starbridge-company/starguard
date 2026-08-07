// ============================================================
// O teto de tempo do scanner — AUDITORIA.md#ARQ-15, #ARQ-16.
//
// O relato: "o sast continua quebrando, no painel também, mesmo no servidor
// dedicado, nunca funciona… ele demora muito e quebra".
//
// A parte "demora muito" era verdade e tinha número. Medido, `--jobs 1`, com o
// ruleset já estreitado para javascript+typescript+generic:
//
//   nesta máquina (16 núcleos, um deles usado), 268 arquivos  →   35 s
//   na imagem de produção (meia CPU),            27 arquivos  →   65 s
//
// Em produção o custo fica na ordem de 1,3 s por arquivo depois do custo fixo
// das regras. A rota aceita **800 arquivos por scan** (`SCAN_MAX_FILES`), o que
// dá ≈ 17 minutos — e o `execFile` matava o opengrep aos 5. **O teto de arquivos
// autorizava um trabalho que o teto de tempo proibia**, e os dois números moram
// em arquivos diferentes que ninguém leu lado a lado.
//
// A parte "quebra" era o desfecho, e é o que estes testes travam. Medido, com um
// `execFile` de teto curto sobre o opengrep de verdade:
//
//   err.code    = null
//   err.killed  = true
//   err.signal  = "SIGTERM"
//   err.stdout  = ""            <- nada a salvar
//   err.message = "Command failed: /usr/local/bin/opengrep --config …"
//
// Cortada em 200 caracteres, a mensagem que chegava à tela era o começo de uma
// linha de comando. Sem a palavra "tempo", sem quanto se esperou, sem o que
// fazer — e indistinguível de uma instalação quebrada, que pede o conserto
// oposto. É o UX-15 ("não encontrou" x "não procurou") aplicado ao tempo.
// ============================================================
import { describe, it, expect } from "vitest";
import { erroDeTeto, morreuNoTeto } from "../src/analyzers/sast";
import { LOCALES } from "../src/i18n/config";

describe("teto estourado x scanner quebrado — são desfechos diferentes", () => {
  it("reconhece a forma EXATA que o Node devolve ao matar o filho no teto", () => {
    // Copiada de uma medição real, não inventada: é esta a forma que o
    // `promisify(execFile)` rejeita quando a opção `timeout` dispara.
    const medido = {
      code: null,
      killed: true,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      message:
        "Command failed: /usr/local/bin/opengrep --config /opt/opengrep-rules/typescript --json --quiet .",
    };
    expect(morreuNoTeto(medido)).toBe(true);
  });

  it("SIGKILL também é morte por fora — inclusive a do kernel sem memória", () => {
    expect(morreuNoTeto({ killed: false, signal: "SIGKILL" })).toBe(true);
  });

  it("um scanner que RODOU e falhou não é teto", () => {
    // Este é o caminho negativo que importa: confundir os dois manda quem lê
    // aumentar o tempo de um scan que nunca ia terminar por outro motivo.
    expect(morreuNoTeto({ code: 7, killed: false, signal: null })).toBe(false);
    expect(morreuNoTeto({ code: "ENOENT", message: "not found" })).toBe(false);
    expect(morreuNoTeto(new Error("qualquer coisa"))).toBe(false);
    expect(morreuNoTeto(undefined)).toBe(false);
  });
});

describe("a mensagem diz TEMPO, e não `Command failed`", () => {
  it("carrega o binário, os segundos e o que aumentar", () => {
    const e = erroDeTeto("/usr/local/bin/opengrep", 900_000, "SAST_TIMEOUT_MS", "pt-BR");
    expect(e.message).toContain("/usr/local/bin/opengrep");
    // 900 s. É o número que responde "esperei pouco ou o scan é grande demais?".
    expect(e.message).toContain("900");
    expect(e.message).toContain("SAST_TIMEOUT_MS");
  });

  it("NÃO devolve a linha de comando — era só isso que cabia nos 200 caracteres", () => {
    const e = erroDeTeto("opengrep", 900_000, "SAST_TIMEOUT_MS", "pt-BR");
    expect(e.message).not.toContain("Command failed");
    expect(e.message).not.toContain("--config");
  });

  it("diz que NENHUM achado saiu — teto estourado não é repositório limpo", () => {
    // O pior desfecho de uma ferramenta de segurança é um relatório vazio que
    // parece um projeto sem problema. Ver UX-15.
    const pt = erroDeTeto("opengrep", 900_000, "SAST_TIMEOUT_MS", "pt-BR").message;
    expect(pt.toLowerCase()).toContain("nenhum achado");
  });

  it("sai no idioma de quem pediu, nos três", () => {
    // Ele é LANÇADO: atravessa o orquestrador e vai parar no JSONB `phases`,
    // que é lido do banco para sempre sem passar por `t()` de novo. Ou sai
    // traduzido daqui, ou sai em português para todo mundo (ver CLAUDE.md).
    const frases = LOCALES.map(
      (l) => erroDeTeto("opengrep", 900_000, "SAST_TIMEOUT_MS", l).message
    );
    expect(new Set(frases).size).toBe(LOCALES.length);
    for (const f of frases) {
      expect(f).toContain("900");
      expect(f).toContain("opengrep");
    }
  });

  it("aponta a CPU antes de apontar o teto", () => {
    // A ordem do conselho não é enfeite. Aumentar o teto faz o scan demorar
    // MAIS; dar CPU ao servidor faz ele terminar. Numa caixa configurada com
    // `SAST_JOBS=1` e `SCAN_SLOTS=1` — herança da instância de meia CPU — é a
    // primeira coisa a mexer, e quem lê a mensagem precisa saber disso.
    const m = erroDeTeto("opengrep", 900_000, "SAST_TIMEOUT_MS", "pt-BR").message;
    expect(m).toContain("SAST_JOBS");
    expect(m.indexOf("SAST_JOBS")).toBeLessThan(m.indexOf("SAST_TIMEOUT_MS"));
  });
});

describe("os dois analisadores usam o MESMO teto lido do ambiente", () => {
  it("`sast.ts` e `sca.ts` não têm mais o 300_000 escrito à mão", async () => {
    // Era um literal em cada arquivo, e nenhum dos dois conversava com
    // `SCAN_MAX_FILES` da rota. Enquanto forem literais, voltam a divergir.
    const { readFile } = await import("node:fs/promises");
    for (const f of ["src/analyzers/sast.ts", "src/analyzers/sca.ts"]) {
      const fonte = await readFile(new URL(`../${f}`, import.meta.url), "utf8");
      expect(fonte).not.toContain("timeout: 300_000");
      expect(fonte).toMatch(/timeout: TETO_S(AST|CA)_MS/);
    }
  });

  it("o teto é configurável por quem hospeda", async () => {
    const { readFile } = await import("node:fs/promises");
    const sast = await readFile(new URL("../src/analyzers/sast.ts", import.meta.url), "utf8");
    const sca = await readFile(new URL("../src/analyzers/sca.ts", import.meta.url), "utf8");
    expect(sast).toContain("process.env.SAST_TIMEOUT_MS");
    expect(sca).toContain("process.env.SCA_TIMEOUT_MS");
  });

  it("o teto é consultado ANTES do `Falha no SAST` genérico", async () => {
    // A ordem é o conserto: abaixo do genérico, o ramo do teto seria
    // inalcançável e nada nos tipos ou no lint acusaria.
    const { readFile } = await import("node:fs/promises");
    const fonte = await readFile(new URL("../src/analyzers/sast.ts", import.meta.url), "utf8");
    const teto = fonte.indexOf("if (morreuNoTeto(err))");
    // O `throw`, e não a menção: a frase também aparece no comentário que
    // explica por que este ramo existe.
    const generico = fonte.indexOf("throw new ScanUnavailable(`Falha no SAST:");
    expect(teto).toBeGreaterThan(0);
    expect(teto).toBeLessThan(generico);
  });
});
