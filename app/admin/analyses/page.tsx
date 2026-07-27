"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/Pagination";
import {
  SearchBox,
  Segmented,
  DateRange,
  UserSelect,
  type UserOption,
} from "@/components/filters";
import { apiGet, ApiError } from "@/lib/client";
import type { Paged } from "@/lib/pagination";
import { fmtDate, StatusPill, SevChips } from "@/components/listing";
import { IconReport } from "@/lib/icons";
import { useT } from "@/lib/i18n";

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
  userId: string;
  userEmail: string;
  userName: string;
}

const STATUS_SEG = [
  { value: "", key: "filter.all" },
  { value: "done", key: "filter.done" },
  { value: "running", key: "filter.running" },
  { value: "error", key: "filter.error" },
  { value: "pending", key: "filter.queued" },
] as const;

export default function AdminAnalysesPage() {
  const t = useT();
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Lista de usuários para o seletor + userId inicial vindo da query.
  useEffect(() => {
    const uid = new URLSearchParams(window.location.search).get("userId");
    if (uid) setUserId(uid);
    apiGet<{ items: UserOption[] }>("/api/admin/users?pageSize=100")
      .then((r) =>
        setUsers(r.items.map((u) => ({ id: u.id, name: u.name, email: u.email })))
      )
      .catch(() => {});
  }, []);

  const onFilter = (fn: () => void) => {
    setPage(1);
    fn();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (userId) params.set("userId", userId);
      setData(await apiGet<Paged<Row>>(`/api/admin/analyses?${params}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("list.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, q, status, from, to, userId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">{t("nav.governance")}</span>
          <h1>{t("nav.globalAnalyses")}</h1>
          <p className="page-subtitle">{t("adminAnalyses.subtitle")}</p>
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
            options={STATUS_SEG.map((o) => ({ value: o.value, label: t(o.key) }))}
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
          <UserSelect
            users={users}
            value={userId}
            onChange={(id) => onFilter(() => setUserId(id))}
          />
        </div>

        {error && <div className="alert error">{error}</div>}

        {loading && !data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : rows.length === 0 ? (
          <div className="empty-state">{t("adminAnalyses.empty")}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("list.colProject")}</th>
                  <th>{t("adminUsers.colUser")}</th>
                  <th>{t("list.colSeverities")}</th>
                  <th>{t("list.colStatus")}</th>
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
                        <span className="cell-sub">
                          {r.repoUrl.replace(/^https?:\/\/github\.com\//, "")}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="cell-strong">{r.userName}</span>
                      <span className="cell-sub">{r.userEmail}</span>
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
