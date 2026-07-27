// ============================================================
// Configuração de idioma. Módulo PURO — usado no servidor, no cliente e no
// middleware (edge). Ver AUDITORIA.md#FEAT-04.
//
// Por que sem biblioteca: o idioma vem de COOKIE, não da URL, então não há
// roteamento a resolver — que é a maior parte do que uma lib de i18n entrega.
// O formato do dicionário (chaves planas com pontos) é o mesmo que o
// `next-intl` consome, caso um dia se queira ICU/pluralização.
// ============================================================

export const LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pt-BR";

/** Cookie legível por JS: a troca de idioma é imediata, sem round-trip. */
export const LOCALE_COOKIE = "sg_locale";

export const LOCALE_LABEL: Record<Locale, string> = {
  "pt-BR": "Português (Brasil)",
  en: "English",
};

/** Nome do idioma para instruir a IA a responder nele. */
export const LOCALE_AI_NAME: Record<Locale, string> = {
  "pt-BR": "português do Brasil",
  en: "English",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function normalizeLocale(v: unknown): Locale {
  if (isLocale(v)) return v;
  // "pt", "pt-PT", "en-US"… caem no idioma base mais próximo.
  if (typeof v === "string") {
    const base = v.split("-")[0]?.toLowerCase();
    if (base === "pt") return "pt-BR";
    if (base === "en") return "en";
  }
  return DEFAULT_LOCALE;
}
