"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import SeverityBadge from "@/components/SeverityBadge";
import { apiGet, ApiError } from "@/lib/client";
import type { Job, Severity } from "@/types";
import { useI18n } from "@/lib/i18n";
import { severityKey } from "@/components/SeverityBadge";
import { IconDownload, IconArrowLeft, IconShield } from "@/lib/icons";

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export default function ReportPage() {
  // A data do rodapé seguia fixa em pt-BR — a frente "Formatação" do FEAT-04.
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Job>(`/api/status/${id}`)
      .then(setJob)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : t("report.loadFailed"))
      );
  }, [id, t]);

  if (error) {
    return (
      <AppShell>
        <div className="alert error">{error}</div>
      </AppShell>
    );
  }
  if (!job) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 400 }} />
      </AppShell>
    );
  }

  const plan = job.phases.plan.result;
  const skills = job.phases.skills.result || [];
  const scan = job.phases.software.result;
  const refactor = job.phases.refactor.result;
  const vulns = scan?.sast.vulnerabilities || [];
  const deps = scan?.sca.dependencies || [];
  const review = scan?.review;
  const reviewFindings = review?.findings || [];

  const sevCount = (s: Severity) =>
    vulns.filter((v) => v.severity === s).length +
    deps.filter((d) => d.severity === s).length +
    reviewFindings.filter((v) => v.severity === s).length;

  return (
    <AppShell>
      <header className="page-header no-print">
        <div>
          <span className="page-kicker">{t("common.report")} · {job.id}</span>
          <h1>{t("report.title")}</h1>
          <p className="page-subtitle">{job.input.projectName}</p>
        </div>
        <div className="header-actions">
          <Link href={`/results/${job.id}`} className="button ghost">
            <IconArrowLeft /> {t("report.back")}
          </Link>
          <button className="button primary" onClick={() => window.print()}>
            <IconDownload /> {t("report.print")}
          </button>
        </div>
      </header>

      <div className="report-doc">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="step-icon">
            <IconShield />
          </div>
          <div>
            <h2 style={{ fontFamily: "var(--font-main)", fontWeight: 800 }}>
              {t("report.docTitle")}
            </h2>
            <p className="muted">
              {t("report.project")}: {job.input.projectName}
              {job.input.repoUrl ? ` · ${job.input.repoUrl}` : ""}
            </p>
          </div>
        </div>

        {/* Metadados da capa. No papel, um relatório sem data, sem id e sem os
            motores usados é impossível de auditar depois — e este documento
            circula por e-mail. Ver AUDITORIA.md#UX-21. */}
        <dl className="report-meta">
          <div>
            <dt>{t("report.metaAnalysis")}</dt>
            <dd className="mono">{job.id}</dd>
          </div>
          <div>
            <dt>{t("report.metaRunAt")}</dt>
            <dd>{new Date(job.createdAt).toLocaleString(locale)}</dd>
          </div>
          <div>
            <dt>{t("report.metaPrintedAt")}</dt>
            <dd>{new Date().toLocaleString(locale)}</dd>
          </div>
          <div>
            <dt>{t("report.metaEngines")}</dt>
            <dd>
              {[scan?.sast.engine, scan?.sca.engine, review?.engine]
                .filter(Boolean)
                .join(" · ") || "—"}
            </dd>
          </div>
        </dl>

        {/* Vulnerabilidades por severidade */}
        <div className="report-section">
          <h3>{t("report.bySeverity")}</h3>
          <div className="sev-summary">
            {SEV_ORDER.map((s) => (
              <div className="sev-tile" key={s}>
                <span className={`count text-${s === "critical" ? "danger" : s === "high" ? "warning" : s === "low" ? "info" : "warning"}`}>
                  {sevCount(s)}
                </span>
                <span className="muted">{t(severityKey(s))}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Requisitos (Fase 1) */}
        {plan && (
          <div className="report-section">
            <h3>{t("report.requirements")}</h3>
            <div className="report-req-list">
              {plan.requirements.map((r, i) => (
                <div className="report-req" key={r.id}>
                  <span className="req-num">{i + 1}</span>
                  <span>
                    <strong>{r.category}:</strong> {r.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills (Fase 2) */}
        <div className="report-section">
          <h3>{t("report.skills")}</h3>
          {skills.length ? (
            <div className="report-req-list">
              {skills.map((s) => (
                <div className="report-req" key={s.skillName}>
                  <span
                    className={`sev sev-${
                      s.verdict === "rejected"
                        ? "critical"
                        : s.verdict === "review"
                          ? "medium"
                          : "low"
                    }`}
                  >
                    <span className="dot" />
                    {t(
                      s.verdict === "rejected"
                        ? "report.skillRejected"
                        : s.verdict === "review"
                          ? "report.skillReview"
                          : "report.skillApproved"
                    )}
                  </span>
                  <span>
                    <strong>{s.skillName}</strong> —{" "}
                    {t("report.findingCount", { n: s.findings.length })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{t("report.noSkills")}</p>
          )}
        </div>

        {/* Vulnerabilidades detalhadas (Fase 3) */}
        <div className="report-section">
          <h3>{t("report.findings")}</h3>
          {vulns.length || deps.length ? (
            <div className="report-req-list">
              {vulns.map((v) => (
                <div className="report-req" key={v.id}>
                  <SeverityBadge severity={v.severity} />
                  <span>
                    <strong>{v.title}</strong> — {v.file}:{v.line} · {v.cwe}
                  </span>
                </div>
              ))}
              {deps.map((d) => (
                <div className="report-req" key={d.id}>
                  <SeverityBadge severity={d.severity} />
                  <span>
                    <strong>{d.package}@{d.installedVersion}</strong> — {d.cve}
                    {d.fixedVersion ? ` (${t("report.fixedIn", { v: d.fixedVersion })})` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{t("report.noFindings")}</p>
          )}
        </div>

        {/* Revisão por IA · regras de negócio (Fase 3) */}
        {review && (
          <div className="report-section">
            <h3>{t("report.aiReview")}</h3>
            {reviewFindings.length ? (
              <div className="report-req-list">
                {reviewFindings.map((v) => (
                  <div className="report-req" key={v.id}>
                    <SeverityBadge severity={v.severity} />
                    <span>
                      <strong>{v.title}</strong> — {v.file}:{v.line}
                      {v.kind === "business-rule" ? ` · ${t("card.businessRule")}` : ""}
                      {v.requirementRefs?.length ? ` · ${v.requirementRefs.join(", ")}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                {review.ran
                  ? t("report.noExtraFindings")
                  : review.note || t("report.reviewNotRun")}
              </p>
            )}
            {review.unverifiedRules?.length ? (
              <div className="report-req-list" style={{ marginTop: 8 }}>
                {review.unverifiedRules.map((r, i) => (
                  <div className="report-req" key={i}>
                    <span className="req-num">?</span>
                    <span>
                      {r.requirementRef ? <strong>{r.requirementRef}: </strong> : null}
                      {r.rule} <span className="muted">— {r.reason}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Correções (Fase 4) */}
        <div className="report-section">
          <h3>{t("report.fixes")}</h3>
          {refactor && refactor.fixes.length ? (
            <div className="report-req-list">
              {refactor.fixes.map((f) => (
                <div className="report-req" key={f.vulnerabilityId}>
                  <span className="req-num">✓</span>
                  <span>
                    <strong>{f.file}</strong> — {f.explanation}
                  </span>
                </div>
              ))}
              {refactor.prs.map((p) => (
                <div className="report-req" key={p.number}>
                  <span className="req-num">PR</span>
                  <span>
                    #{p.number} · {p.title} ({p.branch})
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{t("report.fixesOnDemand")}</p>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 8 }}>
          {t("report.footer")} · {new Date().toLocaleDateString(locale)}
        </p>
      </div>
    </AppShell>
  );
}
