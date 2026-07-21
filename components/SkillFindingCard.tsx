"use client";

import type { SkillValidation } from "@/types";
import SeverityBadge from "@/components/SeverityBadge";
import { IconCheck, IconX, IconSkills } from "@/lib/icons";

const VERDICT: Record<
  SkillValidation["verdict"],
  { label: string; cls: string }
> = {
  approved: { label: "Validada", cls: "sev-low" },
  review: { label: "Requer revisão", cls: "sev-medium" },
  rejected: { label: "Reprovada", cls: "sev-critical" },
};

export default function SkillFindingCard({
  skill,
}: {
  skill: SkillValidation;
}) {
  const verdict = VERDICT[skill.verdict];
  const edge =
    skill.verdict === "rejected"
      ? "critical"
      : skill.verdict === "review"
        ? "medium"
        : "low";

  return (
    <article className={`vuln-card skill-card sev-${edge}-edge`}>
      <div className="vuln-head">
        <div className="vuln-title">
          <IconSkills /> {skill.skillName}
        </div>
        <span className={`sev ${verdict.cls}`}>
          <span className="dot" />
          {verdict.label}
        </span>
      </div>

      <div className="vuln-meta" style={{ flexDirection: "column", gap: 6 }}>
        {skill.checkedItems.map((c) => (
          <span key={c.label} className="meta-item">
            {c.ok ? (
              <span className="text-success" style={{ display: "inline-flex" }}>
                <IconCheck />
              </span>
            ) : (
              <span className="text-danger" style={{ display: "inline-flex" }}>
                <IconX />
              </span>
            )}
            {c.label}
          </span>
        ))}
      </div>

      {skill.findings.length > 0 && (
        <div className="finding-list">
          {skill.findings.map((f) => (
            <div key={f.id} className="vuln-suggestion" style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}>
              <div className="vuln-badges">
                <SeverityBadge severity={f.severity} />
                <span className="badge">{f.type}</span>
                {f.line ? <span className="muted">linha {f.line}</span> : null}
              </div>
              <strong>{f.title}</strong>
              <span className="vuln-desc">{f.description}</span>
              {f.snippet && <pre className="snippet">{f.snippet}</pre>}
              <span className="label">Recomendação</span>
              <span className="vuln-desc">{f.recommendation}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
