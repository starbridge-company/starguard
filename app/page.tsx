"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ThreatInput from "@/components/ThreatInput";
import SkillInput, { type SkillEntry } from "@/components/SkillInput";
import RepoInput from "@/components/RepoInput";
import Collapsible from "@/components/Collapsible";
import InfoTip from "@/components/InfoTip";
import { apiPost, ApiError } from "@/lib/client";
import { IconPlan, IconSkills, IconScan, IconRefactor, IconRepo } from "@/lib/icons";

const PHASES = [
  {
    Icon: IconPlan,
    label: "Ameaças",
    desc: "Fase 1 · Modela ameaças e requisitos de segurança a partir do seu contexto.",
  },
  {
    Icon: IconSkills,
    label: "Skills",
    desc: "Fase 2 · Valida skills/prompts contra injeção e exfiltração.",
  },
  {
    Icon: IconScan,
    label: "Software",
    desc: "Fase 3 · SAST + SCA sobre o repositório, priorizados por severidade.",
  },
  {
    Icon: IconRefactor,
    label: "Correção",
    desc: "Fase 4 · Gera a correção e abre o Pull Request no GitHub.",
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [systemDescription, setSystemDescription] = useState("");
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = projectName.trim() && systemDescription.trim();

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
        token: token.trim() || undefined,
        skills: skills.filter((s) => s.content.trim()),
      });
      router.push(`/results/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao iniciar a análise.");
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">Nova análise</span>
          <h1>Vamos analisar seu projeto</h1>
          <p className="page-subtitle">
            Descreva o sistema e clique em iniciar — o StarGuard cuida das 4 fases.
          </p>
        </div>
        <div className="header-actions">
          <InfoTip
            side="bottom"
            title="Modo demo ativo"
            content="A análise roda ponta a ponta com dados de exemplo (fixtures), sem clonar repositório nem exigir chaves de IA. Para análise real, configure DEMO_MODE=false."
          >
            <span className="badge primary" style={{ cursor: "help" }}>
              <span className="dot" /> Modo demo
            </span>
          </InfoTip>
        </div>
      </header>

      {/* Pipeline compacto — cada fase explica-se num toque, sem poluir a tela */}
      <div className="mini-pipeline" aria-label="As 4 fases">
        {PHASES.map((p, i) => (
          <InfoTip key={p.label} side="bottom" content={p.desc}>
            <span className="mini-step">
              <span className="mini-step-num">{i + 1}</span>
              <p.Icon />
              <span className="mini-step-label">{p.label}</span>
            </span>
          </InfoTip>
        ))}
      </div>

      <form className="panel" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="project-name">Nome do projeto</label>
          <input
            id="project-name"
            className="input"
            placeholder="Ex.: Portal do Paciente"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            required
          />
        </div>

        <ThreatInput value={systemDescription} onChange={setSystemDescription} />

        <Collapsible
          title="Repositório e skills"
          hint="Opcional — conecte o GitHub e envie skills para validar"
          icon={<IconRepo />}
        >
          <div style={{ display: "grid", gap: 20 }}>
            <RepoInput
              repoUrl={repoUrl}
              token={token}
              onRepoUrl={setRepoUrl}
              onToken={setToken}
            />
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
            Iniciar análise
          </button>
        </div>
      </form>
    </AppShell>
  );
}
