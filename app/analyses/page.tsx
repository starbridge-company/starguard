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
import { useT } from "@/lib/i18n";
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
  { value: "", key: "filter.all" },
  { value: "done", key: "filter.done" },
  { value: "running", key: "filter.running" },
  { value: "error", key: "filter.error" },
  { value: "pending", key: "filter.queued" },
] as const;

export default function AnalysesPage() {
  const t = useT();
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
        setError(e instanceof ApiError ? e.message : t("list.loadFailed"));
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
          <span className="page-kicker">{t("list.historyKicker")}</span>
          <h1>{t("list.analysesTitle")}</h1>
          <p className="page-subtitle">{t("list.analysesSubtitle")}</p>
        </div>
        <div className="header-actions">
          <Link href="/" className="button primary">
            <IconBolt /> {t("nav.newAnalysis")}
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="filter-bar">
          <SearchBox
            value={q}
            onChange={(v) => onFilter(() => setQ(v))}
            placeholder={t("list.searchAnalyses")}
          />
          <Segmented
            options={STATUS_SEG.map((s) => ({ value: s.value, label: t(s.key) }))}
            value={status}
            onChange={(v) => onFilter(() => setStatus(v))}
            ariaLabel={t("list.colStatus")}
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
            {t("list.empty")}{" "}
            <Link href="/" className="link">
              {t("list.startFirst")}
            </Link>
            .
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("list.colProject")}</th>
                  <th>{t("list.colSeverities")}</th>
                  <th>{t("list.colFindings")}</th>
                  <th>{t("list.colStatus")}</th>
                  <th>{t("list.colCreated")}</th>
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
                        <span className="cell-sub">{t("list.prs", { n: r.prsCount })}</span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={r.status} progress={r.progress} />
                    </td>
                    <td className="muted">{fmtDate(r.createdAt)}</td>
                    <td className="row-actions">
                      <Link href={`/results/${r.id}`} className="button ghost small">
                        {t("common.open")}
                      </Link>
                      <Link href={`/report/${r.id}`} className="icon-btn" title={t("common.report")}>
                        <IconReport />
                      </Link>
                      {r.repoUrl && (
                        <a
                          href={r.repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="icon-btn"
                          title={t("list.openRepo")}
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
