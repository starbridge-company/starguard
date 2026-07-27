"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { apiGet, ApiError } from "@/lib/client";
import { useT, type MessageKey } from "@/lib/i18n";
import { fmtNum } from "@/components/listing";
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

const SEVS: { key: keyof Metrics; labelKey: MessageKey; cls: string }[] = [
  { key: "critical", labelKey: "severity.critical", cls: "sev-critical" },
  { key: "high", labelKey: "severity.high", cls: "sev-high" },
  { key: "medium", labelKey: "severity.medium", cls: "sev-medium" },
  { key: "low", labelKey: "severity.low", cls: "sev-low" },
];

export default function AdminDashboardPage() {
  const t = useT();
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Metrics>("/api/admin/metrics")
      .then(setM)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : t("admin.metricsFailed"))
      );
  }, [t]);

  const sevTotal = m ? m.critical + m.high + m.medium + m.low : 0;

  const kpis = m
    ? [
        { Icon: IconUsers, label: t("nav.users"), value: m.totalUsers, href: "/admin/users" },
        { Icon: IconScan, label: t("nav.analyses"), value: m.totalAnalyses, href: "/admin/analyses" },
        { Icon: IconShieldAlert, label: t("list.colFindings"), value: m.totalFindings, href: "/admin/analyses" },
        { Icon: IconPullRequest, label: t("nav.pullRequests"), value: m.totalPRs, href: null },
      ]
    : [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">{t("nav.governance")}</span>
          <h1>{t("admin.dashTitle")}</h1>
          <p className="page-subtitle">{t("admin.dashSubtitle")}</p>
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
                  <span className="kpi-value">{fmtNum(k.value)}</span>
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
              <span className="num">{m.last7dAnalyses}</span> {t("admin.last7d")}
            </div>
            <div className="stat-chip">
              <span className="dot run" />
              <span className="num">{m.running}</span> {t("admin.running")}
            </div>
            <div className="stat-chip">
              <span className="dot ok" />
              <span className="num">{m.done}</span> {t("admin.doneCount")}
            </div>
            <div className="stat-chip">
              <span className="dot err" />
              <span className="num">{m.error}</span> {t("admin.errorCount")}
            </div>
          </div>

          {/* Distribuição de severidade */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title-row">
                  <IconChart /> {t("results.bySeverity")}
                </h2>
                <p className="muted">{t("admin.sumOfAll")}</p>
              </div>
            </div>

            {sevTotal === 0 ? (
              <div className="empty-state">{t("admin.noFindings")}</div>
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
                        title={`${t(s.labelKey)}: ${n}`}
                      />
                    ) : null;
                  })}
                </div>
                <div className="sev-legend">
                  {SEVS.map((s) => (
                    <div className="sev-legend-item" key={s.key}>
                      <span className={`sev-dot ${s.cls}`} />
                      <span className="num">{fmtNum(m[s.key] as number)}</span>
                      <span className="muted">{t(s.labelKey)}</span>
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
              <span className="overview-row-label">{t("nav.users")}</span>
              <span className="muted overview-row-value">
                {t("admin.usersHint", { n: m.totalUsers })}
              </span>
              <IconChevronRight />
            </Link>
            <Link href="/admin/analyses" className="overview-row">
              <span className="overview-row-icon">
                <IconScan />
              </span>
              <span className="overview-row-label">{t("nav.globalAnalyses")}</span>
              <span className="muted overview-row-value">
                {t("admin.analysesHint", { n: m.totalAnalyses })}
              </span>
              <IconChevronRight />
            </Link>
          </div>
        </>
      )}
    </AppShell>
  );
}
