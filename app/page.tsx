"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ThreatInput from "@/components/ThreatInput";
import SkillInput, { type SkillEntry } from "@/components/SkillInput";
import RepoInput from "@/components/RepoInput";
import TokenPicker, { type TokenSelection } from "@/components/TokenPicker";
import Collapsible from "@/components/Collapsible";
import InfoTip from "@/components/InfoTip";
import { apiPost, ApiError } from "@/lib/client";
import { parseGitHubRepo } from "@/lib/validation";
import { IconPlan, IconSkills, IconScan, IconRefactor, IconRepo } from "@/lib/icons";
import { useT, type MessageKey } from "@/lib/i18n";

const PHASES = [
  {
    Icon: IconPlan,
    labelKey: "phase1.label" as MessageKey,
    descKey: "phase1.desc" as MessageKey,
  },
  {
    Icon: IconSkills,
    labelKey: "phase2.label" as MessageKey,
    descKey: "phase2.desc" as MessageKey,
  },
  {
    Icon: IconScan,
    labelKey: "phase3.label" as MessageKey,
    descKey: "phase3.desc" as MessageKey,
  },
  {
    Icon: IconRefactor,
    labelKey: "phase4.label" as MessageKey,
    descKey: "phase4.desc" as MessageKey,
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const t = useT();
  const [projectName, setProjectName] = useState("");
  const [systemDescription, setSystemDescription] = useState("");
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [tokenSel, setTokenSel] = useState<TokenSelection>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A URL do repositório é opcional, mas se foi digitada precisa ser válida:
  // antes, o erro só aparecia depois do envio, vindo do servidor.
  // Ver AUDITORIA.md#UX-19.
  const repoOk = !repoUrl.trim() || parseGitHubRepo(repoUrl.trim()) !== null;
  const canSubmit = !!projectName.trim() && !!systemDescription.trim() && repoOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const { id } = await apiPost<{ id: string }>("/api/analyze", {
        projectName: projectName.trim(),
        systemDescription: systemDescription.trim(),
        repoUrl: repoUrl.trim() || undefined,
        tokenId: tokenSel.tokenId || undefined,
        token: tokenSel.token?.trim() || undefined,
        saveToken: tokenSel.saveToken || undefined,
        tokenName: tokenSel.tokenName?.trim() || undefined,
        skills: skills.filter((s) => s.content.trim()),
      });
      router.push(`/results/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("onb.failed"));
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">{t("onb.kicker")}</span>
          <h1>{t("onb.title")}</h1>
          <p className="page-subtitle">
            {t("onb.subtitle")}
          </p>
        </div>
      </header>

      {/* Pipeline compacto — cada fase explica-se num toque, sem poluir a tela */}
      <div className="mini-pipeline" aria-label={t("onb.phases")}>
        {PHASES.map((p, i) => (
          <InfoTip key={p.labelKey} side="bottom" content={t(p.descKey)}>
            <span className="mini-step">
              <span className="mini-step-num">{i + 1}</span>
              <p.Icon />
              <span className="mini-step-label">{t(p.labelKey)}</span>
            </span>
          </InfoTip>
        ))}
      </div>

      <form className="panel" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="project-name">{t("onb.projectName")}</label>
          <input
            id="project-name"
            className="input"
            placeholder={t("onb.projectPlaceholder")}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            required
          />
        </div>

        <ThreatInput value={systemDescription} onChange={setSystemDescription} />

        <Collapsible
          title={t("onb.optional")}
          hint={t("onb.optionalHint")}
          icon={<IconRepo />}
        >
          <div style={{ display: "grid", gap: 20 }}>
            <RepoInput repoUrl={repoUrl} onRepoUrl={setRepoUrl} hideToken />
            <TokenPicker value={tokenSel} onChange={setTokenSel} />
            <SkillInput skills={skills} onChange={setSkills} />
          </div>
        </Collapsible>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            className="button primary large"
            disabled={!canSubmit || loading}
            aria-busy={loading}
          >
            {loading ? <span className="button-spinner" /> : null}
            {t("onb.submit")}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
