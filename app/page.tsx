"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ThreatInput from "@/components/ThreatInput";
import SkillInput, { type SkillEntry } from "@/components/SkillInput";
import RepoInput from "@/components/RepoInput";
import TokenPicker, { type TokenSelection } from "@/components/TokenPicker";
import AnalyzerPicker from "@/components/AnalyzerPicker";
import Collapsible from "@/components/Collapsible";
import { apiPost } from "@/lib/client";
import { parseGitHubRepo } from "@/lib/validation";
import { IconRepo } from "@/lib/icons";
import { useApiError, useT } from "@/lib/i18n";
import { ANALYZER_IDS, type AnalyzerId } from "@/types";

export default function OnboardingPage() {
  const router = useRouter();
  const t = useT();
  const apiError = useApiError();
  const [projectName, setProjectName] = useState("");
  const [systemDescription, setSystemDescription] = useState("");
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [tokenSel, setTokenSel] = useState<TokenSelection>({});
  // Começa com tudo marcado: quem não quer escolher nada continua tendo a
  // análise completa de sempre, sem precisar entender a novidade.
  const [select, setSelect] = useState<AnalyzerId[]>([...ANALYZER_IDS]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A URL do repositório é opcional, mas se foi digitada precisa ser válida:
  // antes, o erro só aparecia depois do envio, vindo do servidor.
  // Ver AUDITORIA.md#UX-19.
  const repoOk = !repoUrl.trim() || parseGitHubRepo(repoUrl.trim()) !== null;

  // O que é obrigatório depende do que foi ESCOLHIDO — a mesma regra que o
  // `analyzeSchema` aplica no servidor. Repetida aqui para o botão desabilitar
  // antes do envio em vez de a rota recusar depois; a rota continua sendo a
  // autoridade.
  const pedidos = new Set(select);
  const precisaDescricao = pedidos.has("threat") || pedidos.has("business");
  const precisaRepo =
    pedidos.has("sast") || pedidos.has("sca") || pedidos.has("business");
  const temSkills = skills.some((s) => s.content.trim());

  const canSubmit =
    !!projectName.trim() &&
    select.length > 0 &&
    repoOk &&
    (!precisaDescricao || !!systemDescription.trim()) &&
    (!precisaRepo || !!repoUrl.trim()) &&
    (!pedidos.has("skills") || temSkills);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const { id } = await apiPost<{ id: string }>("/api/analyze", {
        projectName: projectName.trim(),
        systemDescription: systemDescription.trim(),
        select,
        repoUrl: repoUrl.trim() || undefined,
        tokenId: tokenSel.tokenId || undefined,
        token: tokenSel.token?.trim() || undefined,
        saveToken: tokenSel.saveToken || undefined,
        tokenName: tokenSel.tokenName?.trim() || undefined,
        skills: skills.filter((s) => s.content.trim()),
      });
      router.push(`/results/${id}`);
    } catch (err) {
      setError(apiError(err, "onb.failed"));
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

        {/* A escolha vem ANTES dos campos: é ela que decide o que é exigido.
            Pedir a descrição do sistema para quem só quer rodar o Trivy era o
            custo do fluxo linear. */}
        <AnalyzerPicker
          value={select}
          onChange={setSelect}
          repoUrl={repoOk ? repoUrl : ""}
          hasDescription={!!systemDescription.trim()}
          hasSkills={temSkills}
        />

        {precisaDescricao && (
          <ThreatInput value={systemDescription} onChange={setSystemDescription} />
        )}

        <Collapsible
          title={t("onb.optional")}
          hint={t("onb.optionalHint")}
          icon={<IconRepo />}
          // Abre sozinho quando o repositório passou a ser obrigatório: o campo
          // exigido não pode ficar escondido atrás de "opcional".
          defaultOpen={precisaRepo || pedidos.has("skills")}
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
