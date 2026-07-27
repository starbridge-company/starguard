import "server-only";

// Idioma no lado do servidor: layout (para `<html lang>`) e rotas de API que
// geram texto por IA. Ver AUDITORIA.md#FEAT-04.
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  normalizeLocale,
  type Locale,
} from "./config";

/**
 * Ordem de precedência: cookie (escolha explícita do usuário) > Accept-Language
 * (primeira visita) > padrão.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  if (fromCookie) return normalizeLocale(fromCookie);

  try {
    const h = await headers();
    const accept = h.get("accept-language");
    if (accept) {
      // "pt-BR,pt;q=0.9,en;q=0.8" -> "pt-BR"
      const first = accept.split(",")[0]?.split(";")[0]?.trim();
      if (first) return normalizeLocale(first);
    }
  } catch {
    /* fora de um request: fica no padrão */
  }
  return DEFAULT_LOCALE;
}
