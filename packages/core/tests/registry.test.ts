// ============================================================
// Registro de analisadores — AUDITORIA.md#ARQ-13.
//
// Testa o registro REAL (sem dublê): é ele que o seletor da tela, o
// `starguard list` e a árvore do VS Code consomem. Um analisador que esqueceu
// de declarar `needs` ou `probe` some do seletor sem erro nenhum, e o sintoma
// aparece longe da causa ("pedi sast e não rodou nada").
// ============================================================
import { describe, it, expect } from "vitest";
import { allAnalyzers, getAnalyzer, resolveSelection } from "../src/registry";
import { ANALYZER_IDS, isAnalyzerId } from "../src/types";

describe("registro", () => {
  it("registra exatamente os ids declarados em ANALYZER_IDS", () => {
    expect(allAnalyzers().map((a) => a.id).sort()).toEqual([...ANALYZER_IDS].sort());
  });

  it("nenhum id repetido", () => {
    const ids = allAnalyzers().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo analisador declara `needs` e implementa `probe` e `run`", () => {
    for (const a of allAnalyzers()) {
      expect(a.needs, a.id).toBeTypeOf("object");
      expect(a.needs.workspace, a.id).toBeTypeOf("boolean");
      expect(a.needs.ai, a.id).toBeTypeOf("boolean");
      expect(a.probe, a.id).toBeTypeOf("function");
      expect(a.run, a.id).toBeTypeOf("function");
    }
  });

  it("todo `uses` aponta para um analisador que existe", () => {
    for (const a of allAnalyzers()) {
      for (const u of a.uses ?? []) {
        expect(getAnalyzer(u), `${a.id} usa ${u}`).toBeDefined();
      }
    }
  });

  it("nenhum analisador usa a si mesmo", () => {
    for (const a of allAnalyzers()) {
      expect(a.uses ?? [], a.id).not.toContain(a.id);
    }
  });

  it("os que corrigem trazem `can`, `propose` e `apply`", () => {
    // A correção mora DENTRO da ferramenta que achou o problema: quem tem
    // `fix` precisa do contrato inteiro, senão a tela oferece um botão que
    // não sabe aplicar nada.
    for (const a of allAnalyzers().filter((x) => x.fix)) {
      expect(a.fix!.can, a.id).toBeTypeOf("function");
      expect(a.fix!.propose, a.id).toBeTypeOf("function");
      expect(a.fix!.apply, a.id).toBeTypeOf("function");
    }
  });

  it("sast, sca e business corrigem; threat e skills declaradamente não", () => {
    expect(getAnalyzer("sast")!.fix).toBeDefined();
    expect(getAnalyzer("sca")!.fix).toBeDefined();
    expect(getAnalyzer("business")!.fix).toBeDefined();
    // Ausência deliberada, documentada no próprio analisador: ameaça não é
    // defeito num arquivo, e reescrever uma skill automaticamente entregaria
    // um prompt que ninguém revisou.
    expect(getAnalyzer("threat")!.fix).toBeUndefined();
    expect(getAnalyzer("skills")!.fix).toBeUndefined();
  });

  it("quem precisa de workspace é quem olha para código", () => {
    expect(getAnalyzer("sast")!.needs.workspace).toBe(true);
    expect(getAnalyzer("sca")!.needs.workspace).toBe(true);
    expect(getAnalyzer("business")!.needs.workspace).toBe(true);
    // Estes dois rodam sem repositório nenhum — é o que permite
    // `starguard skills arquivo.md` e a modelagem sobre a descrição do sistema.
    expect(getAnalyzer("threat")!.needs.workspace).toBe(false);
    expect(getAnalyzer("skills")!.needs.workspace).toBe(false);
  });
});

describe("resolveSelection", () => {
  it("ausente, vazio ou 'all' significam todos", () => {
    expect(resolveSelection()).toEqual([...ANALYZER_IDS]);
    expect(resolveSelection([])).toEqual([...ANALYZER_IDS]);
    expect(resolveSelection("all")).toEqual([...ANALYZER_IDS]);
  });

  it("filtra pelo que foi pedido, preservando a ordem de apresentação", () => {
    expect(resolveSelection(["skills", "sast"])).toEqual(["sast", "skills"]);
  });

  it("descarta id desconhecido em silêncio — quem reclama é a camada de entrada", () => {
    expect(resolveSelection(["sca", "dast", "inventado"])).toEqual(["sca"]);
  });
});

describe("isAnalyzerId", () => {
  it("aceita os ids válidos e recusa o resto", () => {
    expect(isAnalyzerId("sast")).toBe(true);
    expect(isAnalyzerId("dast")).toBe(false);
    expect(isAnalyzerId(undefined)).toBe(false);
    expect(isAnalyzerId(42)).toBe(false);
  });
});
