"use client";

// Provider + hook de tradução. Ver AUDITORIA.md#FEAT-04.
import { createContext, useCallback, useContext, useMemo } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  normalizeLocale,
  type Locale,
} from "./config";
import { MESSAGES, PT_BR, type MessageKey } from "./messages";

export type Values = Record<string, string | number>;

/** Substitui `{chave}` pelos valores informados. */
function interpolate(template: string, values?: Values): string {
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
  // Português é a referência; inglês incompleto cai nele em vez de sumir.
  const raw = MESSAGES[locale]?.[key] ?? PT_BR[key] ?? key;
  return interpolate(raw, values);
}

interface Ctx {
  locale: Locale;
  t: (key: MessageKey, values?: Values) => string;
  setLocale: (l: Locale) => void;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({
  locale: initial,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const locale = normalizeLocale(initial);

  const t = useCallback(
    (key: MessageKey, values?: Values) => translate(locale, key, values),
    [locale]
  );

  // Trocar o idioma grava o cookie e recarrega: garante que o HTML servido
  // (inclusive `<html lang>`) venha coerente, sem estado pela metade.
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=strict`;
    window.location.reload();
  }, []);

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Fora do provider (testes, componentes isolados) devolve o idioma padrão em
 * vez de lançar — uma tela não deve quebrar por falta de tradução.
 */
export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    t: (key, values) => translate(DEFAULT_LOCALE, key, values),
    setLocale: () => {},
  };
}

export function useT(): Ctx["t"] {
  return useI18n().t;
}

/**
 * Mensagem de erro de API no idioma do usuário. Prefere a CHAVE (traduzida);
 * cai no texto que o servidor mandou quando a chave é desconhecida — assim
 * mensagens específicas de rota não somem. Ver AUDITORIA.md#PEND-17.
 */
export function useApiError() {
  const { locale } = useI18n();
  return useCallback(
    (e: unknown, fallbackKey: MessageKey = "err.server"): string => {
      const err = e as { key?: string; message?: string } | null;
      if (err?.key && err.key in PT_BR) {
        return translate(locale, err.key as MessageKey);
      }
      if (err?.message) return err.message;
      return translate(locale, fallbackKey);
    },
    [locale]
  );
}

/** Formatação de data no idioma ativo (antes era `pt-BR` fixo). */
export function useFormatDate() {
  const { locale } = useI18n();
  return useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return "—";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    [locale]
  );
}

export type { Locale, MessageKey };
