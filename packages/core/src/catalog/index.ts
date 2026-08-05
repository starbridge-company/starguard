// ============================================================
// Catálogo de explicações — o que cada classe de achado significa.
//
// Cobre as regras e CWEs mais frequentes SEM chamar IA: resposta instantânea,
// custo zero e disponível mesmo sem chave configurada. A IA (lib/enrich.ts) só
// entra no que não está aqui. Ver AUDITORIA.md#FEAT-03.
//
// Um dicionário por idioma — antes só existia português, e um usuário em
// inglês recebia explicação em português (AUDITORIA.md#PEND-18). Hoje são
// três; o teste garante que as CHAVES não divergem entre eles, senão um
// idioma cairia na IA em silêncio e o custo voltaria sem ninguém perceber.
// ============================================================
import type { FindingExplain } from "../types";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "../i18n/config";
import * as ptBR from "./pt-BR";
import * as en from "./en";
import * as es from "./es";
import type { Entry } from "./types";

const BY_LOCALE: Record<Locale, { RULES: Record<string, Entry>; CWES: Record<string, Entry> }> = {
  "pt-BR": { RULES: ptBR.RULES, CWES: ptBR.CWES },
  en: { RULES: en.RULES, CWES: en.CWES },
  es: { RULES: es.RULES, CWES: es.CWES },
};

function norm(s: string | undefined): string {
  return (s || "").trim().toLowerCase();
}

/** Só o último segmento do check_id ("…javascript.lang.security.detect-x"). */
function ruleKey(ruleId: string | undefined): string {
  const seg = norm(ruleId).split(/[.\\/]/).filter(Boolean).pop();
  return seg || "";
}

/** Primeiro identificador CWE presente no texto ("CWE-79: ..."). */
function cweKey(cwe: string | undefined): string {
  const m = /CWE-\d+/i.exec(cwe || "");
  return m ? m[0].toUpperCase() : "";
}

/**
 * Procura no catálogo por regra e, se não achar, por CWE.
 * Retorna undefined quando nada casa — aí entra a IA (lib/enrich.ts).
 */
export function lookupCatalog(
  ruleId: string | undefined,
  cwe: string | undefined,
  locale: string = DEFAULT_LOCALE
): FindingExplain | undefined {
  const dict = BY_LOCALE[normalizeLocale(locale)];
  const byRule = dict.RULES[ruleKey(ruleId)];
  if (byRule) return { ...byRule, source: "catalog" };
  const byCwe = dict.CWES[cweKey(cwe)];
  if (byCwe) return { ...byCwe, source: "catalog" };
  return undefined;
}

/** Entradas do catálogo no idioma informado (usado em teste e diagnóstico). */
export function catalogSize(locale: string = DEFAULT_LOCALE): number {
  const dict = BY_LOCALE[normalizeLocale(locale)];
  return Object.keys(dict.RULES).length + Object.keys(dict.CWES).length;
}

export const CATALOG_SIZE = catalogSize();

/** Chaves presentes em cada idioma — o teste garante que não divergem. */
export function catalogKeys(locale: string): { rules: string[]; cwes: string[] } {
  const dict = BY_LOCALE[normalizeLocale(locale)];
  return {
    rules: Object.keys(dict.RULES).sort(),
    cwes: Object.keys(dict.CWES).sort(),
  };
}
