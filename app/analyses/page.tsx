"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/Pagination";
import { SearchBox, Segmented, DateRange } from "@/components/filters";
import { apiGet, ApiError, isAbortError } from "@/lib/client";
import { useDebounced } from "@/lib/useDebounced";
import type { Paged } from "@/lib/pagination";
import { IconReport, IconBolt, IconExternal } from "@/lib/icons";
import { fmtDate, StatusPill, SevChips } from "@/components/listing";

interface Row {
  id: string;
  projectName: string;
  repoUrl: string | null;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalFindings: number;
  prsCount: number;
  createdAt: string;
  finishedAt: string | null;
}

const STATUS_SEG = [
  { value: "", label: "Todas" },
  { value: "done", label: "Concluídas" },
  { value: "running", label: "Rodando" },
  { value: "error", label: "Erro" },
  { value: "pending", label: "Fila" },
];

export default function AnalysesPage() {
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // A busca só chega aqui depois que o usuário para de digitar.
  const qDebounced = useDebounced(q);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "20" });
        if (qDebounced.trim()) params.set("q", qDebounced.trim());
        if (status) params.set("status", status);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        setData(await apiGet<Paged<Row>>(`/api/analyses?${params}`, { signal }));
      } catch (e) {
        if (isAbortError(e)) return; // substituída por uma busca mais nova
        setError(e instanceof ApiError ? e.message : "Falha ao carregar as análises.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, qDebounced, status, from, to]
  );

  useEffect(() => {
    // Aborta a requisição anterior: evita que uma resposta atrasada
    // sobrescreva o resultado do filtro atual.
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Busca reinicia para a página 1.
  const onFilter = (fn: () => void) => {
    setPage(1);
    fn();
  };

  const rows = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">Histórico</span>
          <h1>Análises</h1>
          <p className="page-subtitle">Suas análises de segurança, da mais recente à mais antiga.</p>
        </div>
        <div className="header-actions">
          <Link href="/" className="button primary">
            <IconBolt /> Nova análise
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="filter-bar">
          <SearchBox
            value={q}
            onChange={(v) => onFilter(() => setQ(v))}
            placeholder="Buscar por projeto ou repositório…"
          />
          <Segmented
            options={STATUS_SEG}
            value={status}
            onChange={(v) => onFilter(() => setStatus(v))}
            ariaLabel="Status"
          />
          <DateRange
            from={from}
            to={to}
            onChange={(f, t) =>
              onFilter(() => {
                setFrom(f);
                setTo(t);
              })
            }
          />
        </div>

        {error && <div className="alert error">{error}</div>}

        {loading && !data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            Nenhuma análise ainda.{" "}
            <Link href="/" className="link">
              Inicie a primeira
            </Link>
            .
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th>Severidades</th>
                  <th>Achados</th>
                  <th>Status</th>
                  <th>Criada</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/results/${r.id}`} className="cell-strong">
                        {r.projectName}
                      </Link>
                      {r.repoUrl && (
                        <span className="cell-sub" title={r.repoUrl}>
                          {r.repoUrl.replace(/^https?:\/\/github\.com\//, "")}
                        </span>
                      )}
                    </td>
                    <td>
                      <SevChips
                        critical={r.criticalCount}
                        high={r.highCount}
                        medium={r.mediumCount}
                        low={r.lowCount}
                      />
                    </td>
                    <td>
                      <span className="num">{r.totalFindings}</span>
                      {r.prsCount > 0 && (
                        <span className="cell-sub">{r.prsCount} PR(s)</span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={r.status} progress={r.progress} />
                    </td>
                    <td className="muted">{fmtDate(r.createdAt)}</td>
                    <td className="row-actions">
                      <Link href={`/results/${r.id}`} className="button ghost small">
                        Abrir
                      </Link>
                      <Link href={`/report/${r.id}`} className="icon-btn" title="Relatório">
                        <IconReport />
                      </Link>
                      {r.repoUrl && (
                        <a
                          href={r.repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="icon-btn"
                          title="Abrir repositório"
                        >
                          <IconExternal />
                        </a>
                      )}
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
