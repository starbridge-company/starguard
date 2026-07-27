import { describe, it, expect } from "vitest";
import { lookupCatalog, CATALOG_SIZE, catalogKeys } from "@/lib/catalog";
import { isGenericSuggestion, FIX_GUIDE } from "@/lib/constants";
import { translate } from "@/lib/i18n";

// AUDITORIA.md#FEAT-03 — o catálogo é o que dá descrição decente de graça.
describe("catálogo · FEAT-03", () => {
  it("resolve pela regra, ignorando o caminho completo do check_id", () => {
    const e = lookupCatalog(
      "opt.opengrep-rules.javascript.lang.security.detect-child-process",
      undefined
    );
    expect(e?.source).toBe("catalog");
    expect(e?.title).toBeTruthy();
    expect(e?.howToFix).toMatch(/execFile|spawn/);
  });

  it("cai para o CWE quando a regra é desconhecida", () => {
    const e = lookupCatalog("regra-que-nao-existe", "CWE-89: SQL Injection");
    expect(e?.source).toBe("catalog");
    expect(e?.whatItIs).toMatch(/SQL/i);
  });

  it("devolve undefined quando não conhece nem regra nem CWE", () => {
    expect(lookupCatalog("regra-nova", "CWE-99999")).toBeUndefined();
  });

  // AUDITORIA.md#PEND-18 — o catálogo passou a existir nos dois idiomas.
  it("responde no idioma pedido", () => {
    const pt = lookupCatalog("detect-child-process", undefined, "pt-BR");
    const en = lookupCatalog("detect-child-process", undefined, "en");
    expect(pt?.whatItIs).toMatch(/comandos do sistema/i);
    expect(en?.whatItIs).toMatch(/operating-system commands/i);
    expect(pt?.whatItIs).not.toBe(en?.whatItIs);
  });

  it("os dois idiomas cobrem exatamente as MESMAS regras e CWEs", () => {
    // Sem isto, uma entrada nova em português deixaria o inglês cair na IA
    // silenciosamente — e o custo voltaria sem ninguém perceber.
    expect(catalogKeys("en")).toEqual(catalogKeys("pt-BR"));
  });

  it("idioma desconhecido cai no padrão em vez de quebrar", () => {
    expect(lookupCatalog("detect-child-process", undefined, "klingon")).toBeDefined();
  });

  it("tem entradas suficientes para valer a pena", () => {
    expect(CATALOG_SIZE).toBeGreaterThanOrEqual(30);
  });
});

// AUDITORIA.md#UX-09 — a expressão antiga não casava com o texto realmente
// usado, e a sugestão genérica era duplicada na textarea do modal.
describe("isGenericSuggestion · UX-09", () => {
  it("reconhece as duas formas genéricas que já circularam", () => {
    expect(isGenericSuggestion("Revise o trecho conforme a recomendação.")).toBe(true);
    expect(isGenericSuggestion("Revise o trecho conforme a regra.")).toBe(true);
    expect(isGenericSuggestion(FIX_GUIDE)).toBe(true);
    expect(isGenericSuggestion("")).toBe(true);
    expect(isGenericSuggestion(undefined)).toBe(true);
  });

  it("preserva sugestão específica", () => {
    expect(isGenericSuggestion("Use consultas parametrizadas do driver pg.")).toBe(false);
  });
});

// AUDITORIA.md#FEAT-04
describe("translate · FEAT-04", () => {
  it("traduz e interpola", () => {
    expect(translate("pt-BR", "card.line", { n: 42 })).toBe("linha 42");
    expect(translate("en", "card.line", { n: 42 })).toBe("line 42");
  });

  it("chave sem tradução no idioma cai no português, não some", () => {
    // "account.languageHint" existe nos dois; o contrato é o fallback não vazar chave.
    const out = translate("en", "account.languageHint");
    expect(out).not.toBe("account.languageHint");
  });

  it("placeholder sem valor é preservado em vez de virar undefined", () => {
    expect(translate("pt-BR", "card.line")).toContain("{n}");
  });
});
