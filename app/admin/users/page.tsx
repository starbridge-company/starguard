"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/Pagination";
import NewUserModal from "@/components/NewUserModal";
import { apiGet, apiPatch, apiDelete, isAbortError } from "@/lib/client";
import { useDebounced } from "@/lib/useDebounced";
import type { Paged } from "@/lib/pagination";
import { useMe } from "@/lib/useMe";
import { SearchBox, RoleSelect } from "@/components/filters";
import { fmtDate } from "@/components/listing";
import { useApiError, useT } from "@/lib/i18n";
import { IconScan, IconPlus, IconTrash } from "@/lib/icons";

interface Row {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
  analysesCount: number;
  totalFindings: number;
  criticalCount: number;
  prsCount: number;
  lastActivity: string | null;
}

export default function AdminUsersPage() {
  const t = useT();
  const apiError = useApiError();
  const { me } = useMe();
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const qDebounced = useDebounced(q);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "20" });
        if (qDebounced.trim()) params.set("q", qDebounced.trim());
        setData(await apiGet<Paged<Row>>(`/api/admin/users?${params}`, { signal }));
      } catch (e) {
        if (isAbortError(e)) return;
        setError(apiError(e, "adminUsers.loadFailed"));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, qDebounced, apiError]
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const changeRole = async (id: string, role: "admin" | "superadmin") => {
    setRoleBusy(id);
    setError(null);
    try {
      await apiPatch(`/api/admin/users/${id}`, { role });
      setData((d) =>
        d ? { ...d, items: d.items.map((u) => (u.id === id ? { ...u, role } : u)) } : d
      );
    } catch (e) {
      setError(apiError(e, "adminUsers.roleFailed"));
    } finally {
      setRoleBusy(null);
    }
  };

  const removeUser = async (id: string, name: string) => {
    if (
      !confirm(
        t("adminUsers.deleteConfirm", { name })
      )
    )
      return;
    setDeleting(id);
    setError(null);
    try {
      await apiDelete(`/api/admin/users/${id}`);
      await load();
    } catch (e) {
      setError(apiError(e, "adminUsers.deleteFailed"));
    } finally {
      setDeleting(null);
    }
  };

  const rows = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">{t("nav.governance")}</span>
          <h1>{t("nav.users")}</h1>
          <p className="page-subtitle">{t("adminUsers.subtitle")}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="button primary"
            onClick={() => setShowNew(true)}
          >
            <IconPlus /> {t("newUser.title")}
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="filter-bar">
          <SearchBox
            value={q}
            onChange={(v) => {
              setPage(1);
              setQ(v);
            }}
            placeholder={t("adminUsers.searchPlaceholder")}
          />
        </div>

        {error && <div className="alert error">{error}</div>}

        {loading && !data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : rows.length === 0 ? (
          <div className="empty-state">{t("adminUsers.empty")}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("adminUsers.colUser")}</th>
                  <th>{t("newUser.role")}</th>
                  <th>{t("nav.analyses")}</th>
                  <th>{t("list.colFindings")}</th>
                  <th>{t("severity.critical")}</th>
                  <th>{t("adminUsers.colPrs")}</th>
                  <th>{t("adminUsers.colLastActivity")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const isSelf = me?.id === u.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <span className="cell-strong">
                          {u.name}
                          {isSelf && <span className="tag">{t("adminUsers.you")}</span>}
                        </span>
                        <span className="cell-sub">{u.email}</span>
                      </td>
                      <td>
                        <RoleSelect
                          value={u.role}
                          disabled={isSelf}
                          busy={roleBusy === u.id}
                          onChange={(r) => changeRole(u.id, r)}
                        />
                      </td>
                      <td>
                        <span className="num">{u.analysesCount}</span>
                      </td>
                      <td>
                        <span className="num">{u.totalFindings}</span>
                      </td>
                      <td>
                        <span
                          className={`num ${u.criticalCount > 0 ? "text-danger" : ""}`}
                        >
                          {u.criticalCount}
                        </span>
                      </td>
                      <td>
                        <span className="num">{u.prsCount}</span>
                      </td>
                      <td className="muted">{fmtDate(u.lastActivity)}</td>
                      <td className="row-actions">
                        <Link
                          href={`/admin/analyses?userId=${u.id}`}
                          className="button ghost small"
                        >
                          <IconScan /> {t("nav.analyses")}
                        </Link>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title={isSelf ? t("adminUsers.cannotDeleteSelf") : t("adminUsers.deleteUser")}
                          disabled={isSelf || deleting === u.id}
                          onClick={() => removeUser(u.id, u.name)}
                        >
                          <IconTrash />
                        </button>
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

      {showNew && (
        <NewUserModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            setPage(1);
            load();
          }}
        />
      )}
    </AppShell>
  );
}
