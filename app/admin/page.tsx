"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { apiGet, ApiError } from "@/lib/client";
import {
  IconUsers,
  IconScan,
  IconShieldAlert,
  IconPullRequest,
  IconClock,
  IconChart,
  IconChevronRight,
} from "@/lib/icons";

interface Metrics {
  totalUsers: number;
  totalAnalyses: number;
  running: number;
  done: number;
  error: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  totalFindings: number;
  totalPRs: number;
  last7dAnalyses: number;
}

const SEVS: { key: keyof Metrics; label: string; cls: string }[] = [
  { key: "critical", label: "Críticas", cls: "sev-critical" },
  { key: "high", label: "Altas", cls: "sev-high" },
  { key: "medium", label: "Médias", cls: "sev-medium" },
  { key: "low", label: "Baixas", cls: "sev-low" },
];

export default function AdminDashboardPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Metrics>("/api/admin/metrics")
      .then(setM)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Falha ao carregar métricas.")
      );
  }, []);

  const sevTotal = m ? m.critical + m.high + m.medium + m.low : 0;

  const kpis = m
    ? [
        { Icon: IconUsers, label: "Usuários", value: m.totalUsers, href: "/admin/users" },
        { Icon: IconScan, label: "Análises", value: m.totalAnalyses, href: "/admin/analyses" },
        { Icon: IconShieldAlert, label: "Achados", value: m.totalFindings, href: "/admin/analyses" },
        { Icon: IconPullRequest, label: "Pull Requests", value: m.totalPRs, href: null },
      ]
    : [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">Governança</span>
          <h1>Painel global</h1>
          <p className="page-subtitle">
            Visão consolidada de todos os usuários, análises e correções.
          </p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {!m ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : (
        <>
          {/* KPIs principais */}
          <div className="kpi-grid">
            {kpis.map((k) => {
              const inner = (
                <>
                  <span className="kpi-icon">
                    <k.Icon />
                  </span>
                  <span className="kpi-value">{k.value.toLocaleString("pt-BR")}</span>
                  <span className="kpi-label">{k.label}</span>
                  {k.href && <IconChevronRight className="kpi-arrow" />}
                </>
              );
              return k.href ? (
                <Link key={k.label} href={k.href} className="kpi-tile link-tile">
                  {inner}
                </Link>
              ) : (
                <div key={k.label} className="kpi-tile">
                  {inner}
                </div>
              );
            })}
          </div>

          {/* Secundários */}
          <div className="stat-row">
            <div className="stat-chip">
              <IconClock />
              <span className="num">{m.last7dAnalyses}</span> nos últimos 7 dias
            </div>
            <div className="stat-chip">
              <span className="dot run" />
              <span className="num">{m.running}</span> em andamento
            </div>
            <div className="stat-chip">
              <span className="dot ok" />
              <span className="num">{m.done}</span> concluídas
            </div>
            <div className="stat-chip">
              <span className="dot err" />
              <span className="num">{m.error}</span> com erro
            </div>
          </div>

          {/* Distribuição de severidade */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title-row">
                  <IconChart /> Achados por severidade
                </h2>
                <p className="muted">Somatório de todas as análises.</p>
              </div>
            </div>

            {sevTotal === 0 ? (
              <div className="empty-state">Nenhum achado registrado ainda.</div>
            ) : (
              <>
                <div className="sev-bar" aria-hidden>
                  {SEVS.map((s) => {
                    const n = m[s.key] as number;
                    const pct = (n / sevTotal) * 100;
                    return n > 0 ? (
                      <span
                        key={s.key}
                        className={`sev-bar-seg ${s.cls}`}
                        style={{ width: `${pct}%` }}
                        title={`${s.label}: ${n}`}
                      />
                    ) : null;
                  })}
                </div>
                <div className="sev-legend">
                  {SEVS.map((s) => (
                    <div className="sev-legend-item" key={s.key}>
                      <span className={`sev-dot ${s.cls}`} />
                      <span className="num">{(m[s.key] as number).toLocaleString("pt-BR")}</span>
                      <span className="muted">{s.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Atalhos */}
          <div className="overview-rows">
            <Link href="/admin/users" className="overview-row">
              <span className="overview-row-icon">
                <IconUsers />
              </span>
              <span className="overview-row-label">Usuários</span>
              <span className="muted overview-row-value">
                {m.totalUsers} conta(s) — ver métricas por usuário
              </span>
              <IconChevronRight />
            </Link>
            <Link href="/admin/analyses" className="overview-row">
              <span className="overview-row-icon">
                <IconScan />
              </span>
              <span className="overview-row-label">Análises (global)</span>
              <span className="muted overview-row-value">
                {m.totalAnalyses} análise(s) de todos os usuários
              </span>
              <IconChevronRight />
            </Link>
          </div>
        </>
      )}
    </AppShell>
  );
}
