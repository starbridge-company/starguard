"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Pagination from "@/components/Pagination";
import NewUserModal from "@/components/NewUserModal";
import { apiGet, apiPatch, apiDelete, ApiError } from "@/lib/client";
import type { Paged } from "@/lib/pagination";
import { useMe } from "@/lib/useMe";
import { SearchBox, RoleSelect } from "@/components/filters";
import { fmtDate } from "@/components/listing";
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
  const { me } = useMe();
  const [data, setData] = useState<Paged<Row> | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (q.trim()) params.set("q", q.trim());
      setData(await apiGet<Paged<Row>>(`/api/admin/users?${params}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao carregar os usuários.");
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    load();
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
      setError(e instanceof ApiError ? e.message : "Falha ao alterar o papel.");
    } finally {
      setRoleBusy(null);
    }
  };

  const removeUser = async (id: string, name: string) => {
    if (
      !confirm(
        `Excluir "${name}"? A conta será desativada (soft delete) e a pessoa não poderá mais entrar. As análises dela permanecem no histórico.`
      )
    )
      return;
    setDeleting(id);
    setError(null);
    try {
      await apiDelete(`/api/admin/users/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao excluir o usuário.");
    } finally {
      setDeleting(null);
    }
  };

  const rows = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">Governança</span>
          <h1>Usuários</h1>
          <p className="page-subtitle">
            Todas as contas — gerencie papéis e acessos.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="button primary"
            onClick={() => setShowNew(true)}
          >
            <IconPlus /> Novo usuário
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
            placeholder="Buscar por nome ou e-mail…"
          />
        </div>

        {error && <div className="alert error">{error}</div>}

        {loading && !data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : rows.length === 0 ? (
          <div className="empty-state">Nenhum usuário encontrado.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Papel</th>
                  <th>Análises</th>
                  <th>Achados</th>
                  <th>Críticas</th>
                  <th>PRs</th>
                  <th>Última atividade</th>
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
                          {isSelf && <span className="tag">você</span>}
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
                          <IconScan /> Análises
                        </Link>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title={isSelf ? "Você não pode excluir a si mesmo" : "Excluir usuário"}
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
