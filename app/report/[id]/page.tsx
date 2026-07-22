"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import SeverityBadge from "@/components/SeverityBadge";
import { apiGet, ApiError } from "@/lib/client";
import type { Job, Severity } from "@/types";
import { SEVERITY_LABEL_PT } from "@/types";
import { IconDownload, IconArrowLeft, IconShield } from "@/lib/icons";

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Job>(`/api/status/${id}`)
      .then(setJob)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Falha ao carregar o relatório.")
      );
  }, [id]);

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
          <span className="page-kicker">Relatório · {job.id}</span>
          <h1>Sumário executivo</h1>
          <p className="page-subtitle">{job.input.projectName}</p>
        </div>
        <div className="header-actions">
          <Link href={`/results/${job.id}`} className="button ghost">
            <IconArrowLeft /> Voltar
          </Link>
          <button className="button primary" onClick={() => window.print()}>
            <IconDownload /> Exportar / Imprimir
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
              StarGuard — Relatório de Segurança
            </h2>
            <p className="muted">
              Projeto: {job.input.projectName}
              {job.input.repoUrl ? ` · ${job.input.repoUrl}` : ""}
            </p>
          </div>
        </div>

        {/* Vulnerabilidades por severidade */}
        <div className="report-section">
          <h3>Vulnerabilidades por severidade</h3>
          <div className="sev-summary">
            {SEV_ORDER.map((s) => (
              <div className="sev-tile" key={s}>
                <span className={`count text-${s === "critical" ? "danger" : s === "high" ? "warning" : s === "low" ? "info" : "warning"}`}>
                  {sevCount(s)}
                </span>
                <span className="muted">{SEVERITY_LABEL_PT[s]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Requisitos (Fase 1) */}
        {plan && (
          <div className="report-section">
            <h3>Requisitos técnicos de segurança (Fase 1)</h3>
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
          <h3>Validação de skills (Fase 2)</h3>
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
                    {s.verdict === "rejected"
                      ? "Reprovada"
                      : s.verdict === "review"
                        ? "Revisar"
                        : "Validada"}
                  </span>
                  <span>
                    <strong>{s.skillName}</strong> — {s.findings.length} achado(s)
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Nenhuma skill validada nesta análise.</p>
          )}
        </div>

        {/* Vulnerabilidades detalhadas (Fase 3) */}
        <div className="report-section">
          <h3>Achados de segurança (Fase 3)</h3>
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
                    {d.fixedVersion ? ` (corrige em ${d.fixedVersion})` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Sem achados de código/dependências.</p>
          )}
        </div>

        {/* Revisão por IA · regras de negócio (Fase 3) */}
        {review && (
          <div className="report-section">
            <h3>Revisão por IA · regras de negócio (Fase 3)</h3>
            {reviewFindings.length ? (
              <div className="report-req-list">
                {reviewFindings.map((v) => (
                  <div className="report-req" key={v.id}>
                    <SeverityBadge severity={v.severity} />
                    <span>
                      <strong>{v.title}</strong> — {v.file}:{v.line}
                      {v.kind === "business-rule" ? " · regra de negócio" : ""}
                      {v.requirementRefs?.length ? ` · ${v.requirementRefs.join(", ")}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                {review.ran
                  ? "Sem achados adicionais além do SAST/SCA."
                  : review.note || "Revisão por IA não executada."}
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
          <h3>Correções aplicadas (Fase 4)</h3>
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
            <p className="muted">Nenhuma correção aplicada automaticamente.</p>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center", marginTop: 8 }}>
          Gerado por StarGuard · Copilot de Segurança · {new Date().toLocaleDateString("pt-BR")}
        </p>
      </div>
    </AppShell>
  );
}
