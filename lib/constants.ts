// ============================================================
// Textos de domínio em um lugar só.
//
// A mesma frase-guia de correção estava copiada em `lib/parsers.ts`,
// `components/FixModal.tsx` e (numa variante) em `lib/agent-fix.ts`. O modal
// tentava detectar a sugestão genérica com uma expressão que não casava com o
// texto realmente usado, e acabava duplicando a frase na tela.
// Ver AUDITORIA.md#ARQ-11 e #UX-09.
//
// Também é a base do i18n (FEAT-04): quando houver mais de um idioma, estas
// constantes viram chaves de tradução — e só elas precisam mudar.
// ============================================================

/** Orientação padrão enviada à IA em toda correção. */
export const FIX_GUIDE =
  "Corrija apenas este problema de segurança, sem alterar a lógica de negócio, mantendo o estilo e a indentação do arquivo.";

/** Sugestão exibida quando o scanner não traz uma recomendação específica. */
export const GENERIC_SUGGESTION = "Revise o trecho conforme a recomendação.";

/**
 * Reconhece qualquer uma das formas genéricas já usadas no projeto (o texto
 * exato mudou entre versões, e achados antigos continuam no banco).
 */
export const GENERIC_SUGGESTION_RE =
  /^\s*(revise o trecho conforme a (regra|recomenda)|corrija apenas este problema de seguran)/i;

export function isGenericSuggestion(s: string | undefined): boolean {
  return !s?.trim() || GENERIC_SUGGESTION_RE.test(s.trim());
}
