// ============================================================
// Tradução PURA — sem React, sem "use client", sem `server-only`.
//
// Por que existe separado de `index.tsx`: aquele arquivo é `"use client"`, e
// tudo o que ele exporta vira referência de cliente quando importado do lado
// do servidor — chamar `translate()` de dentro de `lib/jobs.ts` quebraria. E o
// servidor PRECISA traduzir: mensagens de fase que ficam gravadas no JSONB
// (`phases[].error`, `sast.note`) são escritas uma vez, no idioma de quem
// pediu a análise, e lidas depois direto do banco.
// ============================================================
import { DEFAULT_LOCALE, type Locale } from "./config";
import { MESSAGES, PT_BR, type MessageKey } from "./messages";

export type Values = Record<string, string | number>;

/** Substitui `{chave}` pelos valores informados. */
export function interpolate(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) =>
    k in values ? String(values[k]) : m
  );
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values?: Values
): string {
  // Português é a referência; idioma incompleto cai nele em vez de sumir.
  const raw = MESSAGES[locale]?.[key] ?? PT_BR[key] ?? key;
  return interpolate(raw, values);
}

/** Atalho para quem só tem o idioma como string solta (cookie, coluna do BD). */
export function translateIn(
  locale: Locale | undefined,
  key: MessageKey,
  values?: Values
): string {
  return translate(locale || DEFAULT_LOCALE, key, values);
}

export type { MessageKey };
