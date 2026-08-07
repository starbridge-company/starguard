// ============================================================
// A memória do caminho de scan — AUDITORIA.md#ARQ-15.
//
// A caixa cresceu para 4 GB e isso não torna nada disto opcional: o que este
// caminho tinha não era um teto alto demais, era **teto nenhum sobre a única
// coisa cujo tamanho não se conhece de antemão** — o resultado do scanner. A
// entrada é limitada (`SCAN_MAX_BYTES`); a saída não era.
//
// A conta que faz isso doer, e que não é óbvia: um JSON de N bytes não custa N.
// No V8 ele vira a string em UTF-16 (2N) mais o grafo de objetos do
// `JSON.parse` — 3 a 4× o arquivo, tudo vivo ao mesmo tempo. Com o resultado
// chegando por `stdout` (`maxBuffer: 64 MB`), o pico era decidido DEPOIS de os
// bytes já estarem na memória, e um `maxBuffer` estourado mata o filho e devolve
// `ENOBUFS` — que caía no `Falha no SAST: …` genérico. Um scan derrubado por
// falta de memória do CHAMADOR, anunciado como defeito do scanner.
//
// O conserto é passar o resultado por ARQUIVO (`-o`) e perguntar o tamanho antes
// de gastar memória com ele. Medido: com `-o`, o `stdout` do opengrep volta com
// **0 bytes**.
// ============================================================
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lerAchados } from "../src/analyzers/sast";
import { tetoDeSaidaMb } from "../src/container";

const criados: string[] = [];

async function comArquivo(conteudo: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sg-teste-saida-"));
  criados.push(dir);
  const caminho = join(dir, "achados.json");
  await writeFile(caminho, conteudo, "utf8");
  return caminho;
}

/** Um resultado do opengrep com `n` achados da severidade pedida. */
function achadosFalsos(n: number, severity = "WARNING"): string {
  return JSON.stringify({
    results: Array.from({ length: n }, (_, i) => ({
      check_id: `regra-${i}`,
      path: `src/a${i}.ts`,
      start: { line: i + 1 },
      end: { line: i + 1 },
      extra: { message: `achado ${i}`, severity, lines: "const x = 1;" },
    })),
  });
}

afterEach(async () => {
  for (const d of criados.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("o teto de saída sai do tamanho da CAIXA", () => {
  it("`SCAN_MAX_OUTPUT_MB` tem precedência — quem hospeda sabe da máquina dele", () => {
    const antes = process.env.SCAN_MAX_OUTPUT_MB;
    process.env.SCAN_MAX_OUTPUT_MB = "12";
    try {
      expect(tetoDeSaidaMb()).toBe(12);
    } finally {
      if (antes === undefined) delete process.env.SCAN_MAX_OUTPUT_MB;
      else process.env.SCAN_MAX_OUTPUT_MB = antes;
    }
  });

  it("fora de contêiner vale o teto, não o ilimitado", () => {
    // Sem cgroup não há caixa a proteger, mas 'sem limite' é como se chega a um
    // `JSON.parse` de 300 MB. O teto continua existindo.
    const antes = process.env.SCAN_MAX_OUTPUT_MB;
    delete process.env.SCAN_MAX_OUTPUT_MB;
    try {
      const t = tetoDeSaidaMb();
      expect(t).toBeGreaterThanOrEqual(8);
      expect(t).toBeLessThanOrEqual(64);
    } finally {
      if (antes !== undefined) process.env.SCAN_MAX_OUTPUT_MB = antes;
    }
  });
});

describe("perguntar o TAMANHO antes de gastar memória", () => {
  it("resultado acima do teto é recusado ANTES do `JSON.parse`", async () => {
    // Este é o teste que separa o desenho novo do velho. No velho, a decisão
    // acontecia com os bytes já na memória — ou seja, tarde demais para
    // adiantar alguma coisa.
    const arquivo = await comArquivo(achadosFalsos(10_000));
    const antes = process.env.SCAN_MAX_OUTPUT_MB;
    process.env.SCAN_MAX_OUTPUT_MB = "1";
    try {
      await expect(lerAchados(arquivo, { locale: "pt-BR" })).rejects.toThrow(/MB/);
    } finally {
      if (antes === undefined) delete process.env.SCAN_MAX_OUTPUT_MB;
      else process.env.SCAN_MAX_OUTPUT_MB = antes;
    }
  });

  it("a recusa NÃO se parece com scanner quebrado", async () => {
    // "o scan aconteceu e o resultado não cabe" e "o binário está quebrado"
    // pedem coisas opostas de quem lê. Saíam com a mesma frase.
    const arquivo = await comArquivo(achadosFalsos(10_000));
    const antes = process.env.SCAN_MAX_OUTPUT_MB;
    process.env.SCAN_MAX_OUTPUT_MB = "1";
    try {
      const erro = await lerAchados(arquivo, { locale: "pt-BR" }).catch((e) => e as Error);
      expect(erro).toBeInstanceOf(Error);
      // Diz o que fazer…
      expect(erro.message).toMatch(/SCAN_MAX_OUTPUT_MB/);
      // …e NÃO se disfarça de scanner quebrado nem de `ENOBUFS`.
      expect(erro.message).not.toMatch(/Falha no SAST|ENOBUFS|maxBuffer/);
    } finally {
      if (antes === undefined) delete process.env.SCAN_MAX_OUTPUT_MB;
      else process.env.SCAN_MAX_OUTPUT_MB = antes;
    }
  });

  it("um resultado normal passa inteiro", async () => {
    const arquivo = await comArquivo(achadosFalsos(50));
    expect(await lerAchados(arquivo)).toHaveLength(50);
  });
});

describe("o teto de ACHADOS corta pelos mais graves, e diz", () => {
  it("mantém os mais graves e descarta o resto", async () => {
    // `enrichFindings` devolve um array NOVO, o resultado fica no job pelo TTL e
    // ainda vai para o JSONB. Um repositório patológico multiplica tudo isso.
    const arquivo = await comArquivo(
      JSON.stringify({
        results: [
          ...JSON.parse(achadosFalsos(5, "INFO")).results,
          ...JSON.parse(achadosFalsos(3, "ERROR")).results,
        ],
      })
    );
    const antes = process.env.SCAN_MAX_FINDINGS;
    process.env.SCAN_MAX_FINDINGS = "3";
    try {
      const achados = await lerAchados(arquivo);
      expect(achados).toHaveLength(3);
      // ERROR vira `critical`. Descartar os graves e guardar os `info` seria
      // pior que não cortar nada.
      expect(achados.every((a) => a.severity === "critical")).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.SCAN_MAX_FINDINGS;
      else process.env.SCAN_MAX_FINDINGS = antes;
    }
  });

  it("o corte é DECLARADO — relatório menor não pode ter cara de completo", async () => {
    // UX-15 no lugar mais caro: silenciar isto entrega um relatório parcial
    // indistinguível de um repositório limpo.
    const arquivo = await comArquivo(achadosFalsos(10));
    const ditos: { chave: string; valores?: Record<string, string | number> }[] = [];
    const antes = process.env.SCAN_MAX_FINDINGS;
    process.env.SCAN_MAX_FINDINGS = "4";
    try {
      await lerAchados(arquivo, {
        report: (chave, valores) => ditos.push({ chave, valores }),
      });
      const aviso = ditos.find((d) => d.chave === "scan.findingsCapped");
      expect(aviso).toBeDefined();
      expect(aviso!.valores).toMatchObject({ n: 6, max: 4 });
    } finally {
      if (antes === undefined) delete process.env.SCAN_MAX_FINDINGS;
      else process.env.SCAN_MAX_FINDINGS = antes;
    }
  });

  it("abaixo do teto, ninguém é avisado de nada", async () => {
    // Aviso que aparece quando nada aconteceu treina quem lê a ignorá-lo.
    const arquivo = await comArquivo(achadosFalsos(3));
    const ditos: string[] = [];
    await lerAchados(arquivo, { report: (c) => ditos.push(c) });
    expect(ditos).not.toContain("scan.findingsCapped");
  });
});

describe("o resultado não passa mais pelo cano", () => {
  it("`sast` e `sca` pedem `-o` e deixaram o `maxBuffer` de 64 MB para trás", async () => {
    // Medido: com `-o`, o `stdout` do opengrep volta com 0 bytes. O `maxBuffer`
    // grande era o que transformava um resultado gordo em processo morto.
    const { readFile } = await import("node:fs/promises");
    for (const f of ["sast", "sca"]) {
      const fonte = await readFile(
        new URL(`../src/analyzers/${f}.ts`, import.meta.url),
        "utf8"
      );
      expect(fonte).toContain('"-o"');
      expect(fonte).not.toContain("maxBuffer: 64 * 1024 * 1024");
    }
  });

  it("o JSON intermediário é apagado com QUALQUER desfecho", async () => {
    // Ele carrega trechos do código de quem pediu — a mesma promessa do
    // temporário do job em `lib/scan-jobs.ts`.
    const { readFile } = await import("node:fs/promises");
    for (const f of ["sast", "sca"]) {
      const fonte = await readFile(
        new URL(`../src/analyzers/${f}.ts`, import.meta.url),
        "utf8"
      );
      expect(fonte).toMatch(
        /\} finally \{\s*[\s\S]{0,400}?rm\((?:dirname\(saida\)|trabalho)/
      );
    }
  });
});
