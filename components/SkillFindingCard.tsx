"use client";

import type { SkillValidation } from "@/types";
import SeverityBadge from "@/components/SeverityBadge";
import { useT, type MessageKey } from "@/lib/i18n";
import { PT_BR } from "@/lib/i18n/messages";
import { IconCheck, IconX, IconSkills } from "@/lib/icons";

const VERDICT: Record<
  SkillValidation["verdict"],
  { key: MessageKey; cls: string }
> = {
  approved: { key: "skills.verdictApproved", cls: "sev-low" },
  review: { key: "skills.verdictReview", cls: "sev-medium" },
  rejected: { key: "skills.verdictRejected", cls: "sev-critical" },
};

/**
 * Texto de um item gravado pelo servidor: prefere a CHAVE (traduzida) e cai no
 * texto cru quando a análise é anterior às chaves. Chave desconhecida também
 * cai no texto — melhor mostrar o português antigo que a chave crua na tela.
 */
function useKeyed() {
  const t = useT();
  return (key: string | undefined, fallback: string) =>
    key && key in PT_BR ? t(key as MessageKey) : fallback;
}

export default function SkillFindingCard({
  skill,
}: {
  skill: SkillValidation;
}) {
  const t = useT();
  const keyed = useKeyed();
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
          {t(verdict.key)}
        </span>
      </div>

      <div className="vuln-meta" style={{ flexDirection: "column", gap: 6 }}>
        {skill.checkedItems.map((c) => (
          <span key={c.labelKey || c.label} className="meta-item">
            {c.ok ? (
              <span className="text-success" style={{ display: "inline-flex" }}>
                <IconCheck />
              </span>
            ) : (
              <span className="text-danger" style={{ display: "inline-flex" }}>
                <IconX />
              </span>
            )}
            {keyed(c.labelKey, c.label)}
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
                {f.line ? (
                  <span className="muted">{t("card.line", { n: f.line })}</span>
                ) : null}
              </div>
              <strong>{keyed(f.titleKey, f.title)}</strong>
              <span className="vuln-desc">{f.description}</span>
              {f.snippet && <pre className="snippet">{f.snippet}</pre>}
              <span className="label">{t("card.recommendation")}</span>
              <span className="vuln-desc">
                {keyed(f.recommendationKey, f.recommendation)}
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
