// ============================================================
// Paginação a nível de BD (offset + COUNT). Fonte única de verdade para
// parsear ?page=&pageSize= e para o shape de resposta paginada.
// Reutilizado por TODAS as listagens (contas, análises, PRs, admin).
// ============================================================
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number; // 1-based
  pageSize: number;
  limit: number;
  offset: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

function toInt(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Lê e sanitiza page/pageSize de um URLSearchParams (clamp defensivo). */
export function parsePageParams(sp: URLSearchParams): PageParams {
  const page = Math.max(1, toInt(sp.get("page"), 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, toInt(sp.get("pageSize"), DEFAULT_PAGE_SIZE))
  );
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/** Monta o envelope paginado a partir dos itens da página + total do COUNT. */
export function paged<T>(
  items: T[],
  total: number,
  p: PageParams
): Paged<T> {
  return {
    items,
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}
