"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/Pagination";
import { apiGet, ApiError } from "@/lib/client";
import type { Paged } from "@/lib/pagination";
import { fmtDate } from "@/components/listing";
import { IconPullRequest, IconExternal } from "@/lib/icons";

interface Row {
  id: string;
  analysisId: string | null;
  repoUrl: string;
  number: number;
  url: string;
  title: string;
  branch: string;
  committedCount: number;
  createdAt: string;
}

export default function PullRequestsPage() {
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      setData(await apiGet<Paged<Row>>(`/api/pull-requests?${params}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao carregar os Pull Requests.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">Correções enviadas</span>
          <h1>Pull Requests</h1>
          <p className="page-subtitle">
            PRs de correção que você abriu a partir das análises.
          </p>
        </div>
      </header>

      <section className="panel">
        {error && <div className="alert error">{error}</div>}

        {loading && !data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            Você ainda não abriu nenhum Pull Request. Gere correções em uma análise e
            abra um PR — ele aparece aqui.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pull Request</th>
                  <th>Repositório</th>
                  <th>Arquivos</th>
                  <th>Aberto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cell-strong"
                      >
                        <IconPullRequest /> #{r.number} · {r.title}
                      </a>
                      <span className="cell-sub">{r.branch}</span>
                    </td>
                    <td className="muted">
                      {r.repoUrl.replace(/^https?:\/\/github\.com\//, "")}
                    </td>
                    <td>
                      <span className="num">{r.committedCount}</span>
                    </td>
                    <td className="muted">{fmtDate(r.createdAt)}</td>
                    <td className="row-actions">
                      {r.analysisId && (
                        <Link
                          href={`/results/${r.analysisId}`}
                          className="button ghost small"
                        >
                          Análise
                        </Link>
                      )}
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="icon-btn"
                        title="Abrir no GitHub"
                      >
                        <IconExternal />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <Pagination
            page={data.page}
            pageCount={data.pageCount}
            total={data.total}
            onPage={setPage}
          />
        )}
      </section>
    </AppShell>
  );
}
