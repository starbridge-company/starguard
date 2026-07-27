"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/Pagination";
import {
  SearchBox,
  Segmented,
  DateRange,
  UserSelect,
  type UserOption,
} from "@/components/filters";
import { apiGet, ApiError, isAbortError } from "@/lib/client";
import { useDebounced } from "@/lib/useDebounced";
import type { Paged } from "@/lib/pagination";
import { fmtDate, AuditBadge } from "@/components/listing";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/audit-events";
import { IconRefresh } from "@/lib/icons";

interface Row {
  id: number;
  event: string;
  meta: Record<string, unknown> | null;
  ipHash: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

const CAT_SEG = [
  { value: "", label: "Todos" },
  ...CATEGORY_ORDER.filter((c) => c !== "sistema").map((c) => ({
    value: c,
    label: CATEGORY_META[c].label,
  })),
];

function formatMeta(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const skip = new Set(["userId"]);
  return Object.entries(meta)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" · ");
}

export default function MonitoringPage() {
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ items: UserOption[] }>("/api/admin/users?pageSize=100")
      .then((r) => setUsers(r.items.map((u) => ({ id: u.id, name: u.name, email: u.email }))))
      .catch(() => {});
  }, []);

  const onFilter = (fn: () => void) => {
    setPage(1);
    fn();
  };

  const qDebounced = useDebounced(q);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "25" });
        if (qDebounced.trim()) params.set("q", qDebounced.trim());
        if (category) params.set("category", category);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (userId) params.set("userId", userId);
        setData(await apiGet<Paged<Row>>(`/api/admin/audit?${params}`, { signal }));
      } catch (e) {
        if (isAbortError(e)) return;
        setError(e instanceof ApiError ? e.message : "Falha ao carregar os logs.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, qDebounced, category, from, to, userId]
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const rows = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">Governança</span>
          <h1>Monitoramento</h1>
          <p className="page-subtitle">
            Trilha de auditoria de tudo o que acontece na plataforma.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="button ghost" onClick={() => void load()}>
            <IconRefresh /> Atualizar
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="filter-bar">
          <SearchBox
            value={q}
            onChange={(v) => onFilter(() => setQ(v))}
            placeholder="Buscar por evento ou detalhe…"
          />
          <Segmented
            options={CAT_SEG}
            value={category}
            onChange={(v) => onFilter(() => setCategory(v))}
            ariaLabel="Categoria"
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
          <div className="skeleton" style={{ height: 260 }} />
        ) : rows.length === 0 ? (
          <div className="empty-state">Nenhum registro para os filtros atuais.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Evento</th>
                  <th>Usuário</th>
                  <th>Detalhe</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const detail = formatMeta(r.meta);
                  return (
                    <tr key={r.id}>
                      <td className="muted nowrap">{fmtDate(r.createdAt)}</td>
                      <td>
                        <AuditBadge event={r.event} />
                      </td>
                      <td>
                        {r.userName ? (
                          <>
                            <span className="cell-strong">{r.userName}</span>
                            <span className="cell-sub">{r.userEmail}</span>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {detail ? (
                          <span className="audit-detail mono" title={detail}>
                            {detail}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="mono muted nowrap">
                        {r.ipHash ? r.ipHash.slice(0, 10) : "—"}
                      </td>
                    </tr>
                  );
                })}
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
