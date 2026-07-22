"use client";

import { IconChevronRight, IconArrowLeft } from "@/lib/icons";

// Paginação visual (números de página) alimentada pelo COUNT do BD.
export default function Pagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total?: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) {
    return total !== undefined ? (
      <div className="pagination">
        <span className="muted">{total} no total</span>
      </div>
    ) : null;
  }

  // Janela de páginas em torno da atual (compacta): 1 … p-1 p p+1 … N
  const pages: (number | "…")[] = [];
  const push = (n: number) => pages.push(n);
  const window = 1;
  const from = Math.max(2, page - window);
  const to = Math.min(pageCount - 1, page + window);
  push(1);
  if (from > 2) pages.push("…");
  for (let i = from; i <= to; i++) push(i);
  if (to < pageCount - 1) pages.push("…");
  if (pageCount > 1) push(pageCount);

  return (
    <div className="pagination">
      {total !== undefined && (
        <span className="muted pagination-total">{total} no total</span>
      )}
      <div className="pagination-controls">
        <button
          type="button"
          className="page-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Página anterior"
        >
          <IconArrowLeft />
        </button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="page-ellipsis">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`page-btn ${p === page ? "active" : ""}`}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className="page-btn"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          aria-label="Próxima página"
        >
          <IconChevronRight />
        </button>
      </div>
    </div>
  );
}
