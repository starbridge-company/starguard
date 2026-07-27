"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PipelineStepper, { type PipelineStep } from "@/components/PipelineStepper";
import SectionTabs, { type SectionTab } from "@/components/SectionTabs";
import VulnerabilityCard, { DependencyCard } from "@/components/VulnerabilityCard";
import SkillFindingCard from "@/components/SkillFindingCard";
import SeverityBadge, { severityKey } from "@/components/SeverityBadge";
import FixModal from "@/components/FixModal";
import BatchFixModal from "@/components/BatchFixModal";
import InfoTip from "@/components/InfoTip";
import { apiPost, ApiError } from "@/lib/client";
import { useAnalysisPolling, allTerminal } from "@/lib/useAnalysisPolling";
import { useFindings, isResolved } from "@/lib/useFindings";
import { Segmented, SearchBox } from "@/components/filters";
import { useT } from "@/lib/i18n";

import { SEVERITY_ORDER } from "@/types";
import type {
  Vulnerability,
  FixResult,
  PullRequest,
  PhaseKey,
  Severity,
  StepStatus,
} from "@/types";
import {
  IconReport,
  IconRefresh,
  IconRefactor,
  IconPlan,
  IconSkills,
  IconScan,
  IconPackage,
  IconChevronRight,
} from "@/lib/icons";

/** Cards renderizados por vez na aba de correções. */
const PAGE = 25;

type TabId = "overview" | "code" | "deps" | "threats" | "skills";

const SEV_TEXT: Record<Severity, string> = {
  critical: "danger",
  high: "warning",
  medium: "warning",
  low: "info",
  info: "info",
};

const EXT_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  php: "php",
  cs: "csharp",
  rs: "rust",
  sql: "sql",
};

function guessLang(file: string): string | undefined {
  const ext = file.split(".").pop()?.toLowerCase();
  return ext ? EXT_LANG[ext] : undefined;
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const { job, error, degraded, retry } = useAnalysisPolling(id);

  const t = useT();
  const [tab, setTab] = useState<TabId>("overview");

  // Estado do fluxo de correção individual (FixModal).
  const [selVuln, setSelVuln] = useState<Vulnerability | null>(null);
  const [fix, setFix] = useState<FixResult | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [prState, setPrState] = useState<"idle" | "loading" | "done">("idle");
  const [pr, setPr] = useState<PullRequest | null>(null);

  // Seleção para correção em lote.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);

  // Estado por achado (corrigido / falso positivo / PR aberto), persistido.
  const softwareDone = job?.phases.software.status === "done";
  const {
    byLocal: findingState,
    setStatus: setFindingStatus,
    reload: reloadFindings,
  } = useFindings(id, !!softwareDone);
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">(
    "open"
  );
  // Filtros da lista de correções. Sem eles, um repositório real (o teste
  // interno produziu 576 achados) vira uma parede de cards impossível de
  // navegar — e de renderizar. Ver AUDITORIA.md#UX-01.
  const [sevFilter, setSevFilter] = useState<string>("");
  const [srcFilter, setSrcFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // Abre o modal SEM gerar — o usuário pode ajustar as instruções antes.
  // Se já houver correção guardada para este achado, ela é CARREGADA (não
  // regerada): era exatamente aqui que se queimava IA à toa a cada reabertura.
  // Ver AUDITORIA.md#FEAT-02.
  const openFix = (vuln: Vulnerability) => {
    setSelVuln(vuln);
    setFix(null);
    setFixError(null);
    setPr(null);
    setPrState("idle");
    if (findingState[vuln.id]?.hasFix) {
      void runFix(vuln, "", false);
    }
  };

  // Gera (ou refaz) a correção com o prompt personalizado + contexto do erro.
  // `force` = "Refazer": só então gastamos IA de novo. Sem ele, a rota devolve
  // a correção já guardada. Ver AUDITORIA.md#FEAT-02.
  // `vuln` vem por parâmetro (e não do estado) porque `openFix` precisa
  // disparar isto no mesmo tick em que seleciona o achado.
  const runFix = async (
    vuln: Vulnerability,
    instructions: string,
    force: boolean
  ) => {
    setFix(null);
    setFixError(null);
    setFixLoading(true);
    try {
      const result = await apiPost<FixResult>("/api/step4-fix", {
        findingId: findingState[vuln.id]?.id,
        force,
        vulnerabilityId: vuln.id,
        file: vuln.file,
        originalCode: vuln.codeSnippet || vuln.description || vuln.title,
        description: vuln.description || vuln.title,
        suggestion: vuln.suggestion,
        language: guessLang(vuln.file),
        line: vuln.line,
        endLine: vuln.endLine,
        cwe: vuln.cwe,
        owasp: vuln.owasp,
        ruleId: vuln.ruleId,
        repoUrl: job?.input.repoUrl,
        userInstructions: instructions.trim() || undefined,
      });
      setFix(result);
      if (!force) void reloadFindings(); // pode ter passado a existir correção
    } catch (err) {
      setFixError(err instanceof ApiError ? err.message : t("fix.failed"));
    } finally {
      setFixLoading(false);
    }
  };

  const generateFixFor = (instructions: string) => {
    if (!selVuln) return;
    // Já existe correção na tela => o botão é "Refazer" => gasta IA de novo.
    void runFix(selVuln, instructions, !!fix);
  };

  const openPR = async () => {
    if (!fix || !job?.input.repoUrl || fix.noChange) return;
    setPrState("loading");
    try {
      const title = `Correção de segurança: ${selVuln?.title || fix.file}`;
      // O engine de agente pode ter editado VÁRIOS arquivos. Mandar só
      // `fix.file` gerava um PR incompleto — que muitas vezes nem compila.
      // Ver AUDITORIA.md#BUG-07.
      const changed = fix.changedFiles?.length ? fix.changedFiles : null;

      const result =
        changed && changed.length > 1
          ? await apiPost<PullRequest>("/api/github/pr-batch", {
              repoUrl: job.input.repoUrl,
              files: changed.map((c) => ({
                file: c.file,
                fixedCode: c.fixedCode,
              })),
              title,
              body: `${fix.explanation}\n\nArquivos alterados: ${changed
                .map((c) => `\`${c.file}\``)
                .join(", ")}`,
              analysisId: job.id,
            })
          : await apiPost<PullRequest>("/api/github/pr", {
              repoUrl: job.input.repoUrl,
              file: fix.file,
              fixedCode: fix.fixedCode,
              title,
              body: fix.explanation,
              analysisId: job.id,
            });

      setPr(result);
      setPrState("done");
      // O achado passa a "PR aberto" — some da lista de trabalho e a próxima
      // análise deste repositório já nasce sabendo. Ver AUDITORIA.md#FEAT-01.
      if (selVuln && findingState[selVuln.id]) {
        void setFindingStatus(selVuln.id, "pr_open");
      }
    } catch (err) {
      setPrState("idle");
      setFixError(
        err instanceof ApiError ? err.message : t("fix.failed")
      );
    }
  };

  // Erro só toma a tela inteira quando nunca conseguimos carregar nada. Se a
  // análise já apareceu uma vez, a falha vira aviso — o polling continua
  // tentando sozinho por baixo (AUDITORIA.md#BUG-04).
  if (error && !job) {
    return (
      <AppShell>
        <div className="alert error">{error}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="button primary" onClick={retry}>
            <IconRefresh /> {t("common.retry")}
          </button>
          <Link href="/" className="button ghost">
            ← Nova análise
          </Link>
        </div>
      </AppShell>
    );
  }

  if (!job) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </AppShell>
    );
  }

  const plan = job.phases.plan.result;
  const skills = job.phases.skills.result || [];
  const scan = job.phases.software.result;
  const refactor = job.phases.refactor.result;

  const vulns = scan ? scan.sast.vulnerabilities : [];
  const deps = scan?.sca.dependencies || [];
  const review = scan?.review;
  const reviewFindings = review?.findings || [];

  // A revisão por IA deixa de ter aba própria: seus achados entram na lista de
  // Correções, deduplicados contra o SAST (mesmo arquivo, linha ±3 e mesmo
  // CWE/regra) — para não repetir uma correção que já está lá.
  const normPath = (f: string) => f.replace(/\\/g, "/").toLowerCase();
  const collidesWithSast = (r: Vulnerability) =>
    vulns.some(
      (v) =>
        normPath(v.file) === normPath(r.file) &&
        Math.abs((v.line || 0) - (r.line || 0)) <= 3 &&
        ((!!v.cwe && v.cwe === r.cwe) || (!!v.ruleId && v.ruleId === r.ruleId))
    );
  const aiFindings = reviewFindings.filter((r) => !collidesWithSast(r));
  const corrections = [...vulns, ...aiFindings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  // Achados já resolvidos (por você ou herdados de uma análise anterior deste
  // repositório) saem da lista de trabalho por padrão. Ver AUDITORIA.md#FEAT-01.
  const resolvedCount = corrections.filter((v) =>
    isResolved(findingState[v.id]?.status)
  ).length;
  const q = query.trim().toLowerCase();
  const filteredCorrections = corrections.filter((v) => {
    if (statusFilter !== "all") {
      const done = isResolved(findingState[v.id]?.status);
      if (statusFilter === "resolved" ? !done : done) return false;
    }
    if (sevFilter && v.severity !== sevFilter) return false;
    if (srcFilter && v.source !== srcFilter) return false;
    if (
      q &&
      !`${v.file} ${v.ruleId} ${v.title} ${v.cwe ?? ""}`.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
  // Renderiza por partes: cada card traz um bloco de código, e centenas deles
  // de uma vez travam o navegador.
  const visibleCorrections = filteredCorrections.slice(0, limit);
  const hiddenByLimit = filteredCorrections.length - visibleCorrections.length;

  const criticalCount = corrections.filter((v) => v.severity === "critical").length;
  const skillsRejected = skills.filter((s) => s.verdict !== "approved").length;

  // Quais analisadores REALMENTE rodaram. Sem isto, uma lista vazia porque o
  // binário não existe no host era exibida como "repositório limpo 🎉".
  const scannersRan = {
    code: !!scan && (scan.sast.ran || !!scan.review?.ran),
    deps: !!scan && scan.sca.ran,
    reasons: [
      scan && !scan.sast.ran
        ? scan.sast.note || `O SAST (${scan.sast.engine}) não foi executado.`
        : "",
      scan && !scan.review?.ran && scan.review?.note ? scan.review.note : "",
    ].filter(Boolean),
  };

  const stepMetrics = (key: PhaseKey) => {
    if (key === "plan" && plan)
      return [
        { label: "ameaças", value: plan.threats.length },
        { label: "requisitos", value: plan.requirements.length },
      ];
    if (key === "skills" && job.phases.skills.status === "done")
      return [
        { label: "skills", value: skills.length },
        { label: "reprovadas", value: skillsRejected },
      ];
    if (key === "software" && scan)
      return [
        { label: "SAST", value: vulns.length },
        { label: "IA", value: aiFindings.length },
        { label: "SCA", value: deps.length },
      ];
    if (key === "refactor" && refactor)
      return [
        { label: "correções", value: refactor.fixes.length },
        { label: "PRs", value: refactor.prs.length },
      ];
    return [];
  };

  const done = allTerminal(job);

  const steps: PipelineStep[] = (
    ["plan", "skills", "software", "refactor"] as PhaseKey[]
  ).map((k) => ({
    key: k,
    status: job.phases[k].status,
    ai: job.phases[k].ai,
    engines: job.phases[k].engines,
    metrics: stepMetrics(k),
  }));

  const toggleOne = (v: Vulnerability) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v.id)) next.delete(v.id);
      else next.add(v.id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === visibleCorrections.length
        ? new Set()
        : new Set(visibleCorrections.map((v) => v.id))
    );

  const sevCount = (s: Severity) =>
    corrections.filter((v) => v.severity === s).length +
    deps.filter((d) => d.severity === s).length;

  const statusText = (status: StepStatus) =>
    status === "running"
      ? "rodando…"
      : status === "pending"
        ? "aguardando"
        : status === "error"
          ? "erro"
          : "concluído";

  // Estado "fase ainda não pronta" (rodando / aguardando / erro).
  const notReady = (key: PhaseKey, running: string) => {
    const st = job.phases[key].status;
    if (st === "running")
      return (
        <div className="empty-state">
          <span
            className="button-spinner"
            style={{ borderTopColor: "hsl(var(--accent))" }}
          />
          <p>{running}</p>
        </div>
      );
    if (st === "pending")
      return <div className="empty-state">Aguardando as fases anteriores…</div>;
    if (st === "error")
      return <div className="alert error">{job.phases[key].error || "Falha nesta fase."}</div>;
    return null;
  };

  const tabs: SectionTab[] = [
    { id: "overview", label: t("tab.overview") },
    {
      id: "code",
      label: t("tab.fixes"),
      count: corrections.length,
      tone: criticalCount > 0 ? "danger" : "accent",
    },
    {
      id: "deps",
      label: t("tab.deps"),
      count: deps.length,
      tone: deps.some((d) => d.severity === "critical" || d.severity === "high")
        ? "warning"
        : "default",
    },
    { id: "threats", label: t("tab.threats"), count: plan?.threats.length ?? 0 },
    { id: "skills", label: t("tab.skills"), count: skills.length },
  ];

  const overviewRows = [
    {
      id: "code" as TabId,
      Icon: IconScan,
      label: "Correções de segurança",
      value: scan
        ? `${corrections.length} correção(ões)`
        : statusText(job.phases.software.status),
    },
    {
      id: "deps" as TabId,
      Icon: IconPackage,
      label: "Dependências (SCA)",
      value: scan
        ? `${deps.length} com CVE`
        : statusText(job.phases.software.status),
    },
    {
      id: "threats" as TabId,
      Icon: IconPlan,
      label: "Ameaças",
      value: plan
        ? `${plan.threats.length} ameaças · ${plan.requirements.length} requisitos`
        : statusText(job.phases.plan.status),
    },
    {
      id: "skills" as TabId,
      Icon: IconSkills,
      label: "Skills",
      value:
        job.phases.skills.status === "done"
          ? `${skills.length} validada(s)`
          : statusText(job.phases.skills.status),
    },
  ];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">{t("results.kicker")} · {job.id}</span>
          <h1>{job.input.projectName}</h1>
          <p className="page-subtitle">
            {done
              ? t("results.doneSubtitle")
              : t("results.runningSubtitle")}
          </p>
        </div>
        <div className="header-actions">
          {!done && (
            <span className="badge primary">
              <span className="dot" /> {job.progress}%
            </span>
          )}
          <Link href={`/report/${job.id}`} className="button ghost">
            <IconReport /> {t("common.report")}
          </Link>
          <Link href="/" className="button ghost">
            <IconRefresh /> {t("common.new")}
          </Link>
        </div>
      </header>

      {!done && (
        <div className="progress-track" aria-label="progresso">
          <div className="progress-fill" style={{ width: `${job.progress}%` }} />
        </div>
      )}

      {degraded && (
        <div className="alert info">
          <span>
            {t("results.degraded")}
            {error ? ` (${error})` : ""}
          </span>
          <button
            type="button"
            className="button ghost small"
            onClick={retry}
            style={{ marginLeft: "auto" }}
          >
            <IconRefresh /> {t("results.refreshNow")}
          </button>
        </div>
      )}

      <PipelineStepper steps={steps} />

      <SectionTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />

      {/* ---------- VISÃO GERAL ---------- */}
      {tab === "overview" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title-row">
                Visão geral
                <InfoTip
                  title="Visão geral"
                  content="Resumo do que a análise encontrou. Comece pelas correções de código — é onde você resolve os problemas e abre um PR."
                />
              </h2>
              <p className="muted">
                {done ? "Análise concluída." : "Análise em andamento…"}
              </p>
            </div>
          </div>

          {corrections.length > 0 && (
            <div className="cta-banner">
              <div className="cta-text">
                <strong>
                  {corrections.length} correção(ões) de segurança a aplicar
                </strong>
                <span className="muted">
                  {criticalCount} crítica(s). Gere correções com IA e abra um Pull
                  Request.
                </span>
              </div>
              <button
                type="button"
                className="button primary large"
                onClick={() => setTab("code")}
              >
                <IconRefactor /> Ir para correções
              </button>
            </div>
          )}

          <div>
            <h3 className="section-subtitle">Achados por severidade</h3>
            <div className="sev-summary">
              {(["critical", "high", "medium", "low"] as Severity[]).map((s) => (
                <div className="sev-tile" key={s}>
                  <span className={`count text-${SEV_TEXT[s]}`}>{sevCount(s)}</span>
                  <span className="muted">{t(severityKey(s))}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="section-subtitle">Seções</h3>
            <div className="overview-rows">
              {overviewRows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="overview-row"
                  onClick={() => setTab(r.id)}
                >
                  <span className="overview-row-icon">
                    <r.Icon />
                  </span>
                  <span className="overview-row-label">{r.label}</span>
                  <span className="muted overview-row-value">{r.value}</span>
                  <IconChevronRight />
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------- CORREÇÕES (SAST + revisão por IA, deduplicadas) ---------- */}
      {tab === "code" && (
        <section className="panel" id="software">
          <div className="panel-header">
            <div>
              <h2 className="panel-title-row">
                Correções
                <InfoTip
                  title="Correções de segurança"
                  content="Reúne as vulnerabilidades do scanner (SAST) e os achados da revisão por IA (regra de negócio, IDOR/autorização, lógica multi-arquivo). Os achados da IA que repetiriam um do SAST são descartados. Selecione o que quer resolver e gere correções com IA — cada uma pode virar um Pull Request."
                />
              </h2>
              <p className="muted">
                Selecione os itens e aplique correções com IA.
                {aiFindings.length > 0 ? (
                  <>
                    {" "}
                    Inclui <strong>{aiFindings.length}</strong> achado(s) da revisão
                    por IA.
                  </>
                ) : null}
              </p>
            </div>
          </div>

          {notReady("software", t("fixes.analyzing"))}

          {/* Transparência de cobertura: a revisão por IA lê uma AMOSTRA do
              repositório. Apresentar o resultado sem dizer isso passaria a
              impressão de que o projeto inteiro foi revisado.
              Ver AUDITORIA.md#UX-06. */}
          {review?.ran && review.coverage && (
            <div className="alert info">
              <span>
                A revisão por IA leu{" "}
                <strong>
                  {review.coverage.filesReviewed} de{" "}
                  {review.coverage.filesEligible}
                </strong>{" "}
                arquivos elegíveis (priorizando autenticação, rotas, banco e os
                arquivos que o SAST apontou)
                {review.coverage.truncatedFiles > 0 && (
                  <>
                    ; {review.coverage.truncatedFiles} foram truncados por
                    tamanho
                  </>
                )}
                . O SAST e o SCA analisaram o repositório inteiro.
              </span>
            </div>
          )}

          {job.phases.software.status === "done" &&
            corrections.length === 0 &&
            (scannersRan.code ? (
              <div className="empty-state">
                Nenhuma correção de segurança encontrada. 🎉
              </div>
            ) : (
              // "Nada encontrado" e "nada foi procurado" são coisas MUITO
              // diferentes num produto de segurança. Ver AUDITORIA.md#UX-15.
              <div className="alert error">
                <span>
                  <strong>Nenhum analisador de código rodou.</strong>{" "}
                  {scannersRan.reasons.join(" ")} Isto não significa que o
                  repositório esteja limpo — significa que ele não foi analisado.
                </span>
              </div>
            ))}

          {corrections.length > 0 && (
            <>
              <div className="filter-bar">
                <SearchBox
                  value={query}
                  onChange={(v) => {
                    setQuery(v);
                    setLimit(PAGE);
                  }}
                  placeholder={t("fixes.searchPlaceholder")}
                />
                <Segmented
                  options={[
                    { value: "", label: t("fixes.allSeverities") },
                    { value: "critical", label: t("severity.critical") },
                    { value: "high", label: t("severity.high") },
                    { value: "medium", label: t("severity.medium") },
                    { value: "low", label: t("severity.low") },
                  ]}
                  value={sevFilter}
                  onChange={(v) => {
                    setSevFilter(v);
                    setLimit(PAGE);
                  }}
                  ariaLabel="Severidade"
                />
                <Segmented
                  options={[
                    { value: "", label: t("fixes.allSources") },
                    { value: "sast", label: t("fixes.sourceSast") },
                    { value: "ai-review", label: t("fixes.sourceAi") },
                  ]}
                  value={srcFilter}
                  onChange={(v) => {
                    setSrcFilter(v);
                    setLimit(PAGE);
                  }}
                  ariaLabel="Origem"
                />
              </div>

              <div className="finding-toolbar">
                <Segmented
                  options={[
                    {
                      value: "open",
                      label: t("fixes.filterOpen", { n: corrections.length - resolvedCount }),
                    },
                    { value: "resolved", label: t("fixes.filterResolved", { n: resolvedCount }) },
                    { value: "all", label: t("fixes.filterAll") },
                  ]}
                  value={statusFilter}
                  onChange={(v) => {
                    setStatusFilter(v as "open" | "resolved" | "all");
                    setLimit(PAGE);
                  }}
                  ariaLabel="Filtrar por estado"
                />
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={
                      visibleCorrections.length > 0 &&
                      selected.size === visibleCorrections.length
                    }
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          selected.size > 0 &&
                          selected.size < visibleCorrections.length;
                    }}
                    onChange={toggleAll}
                  />
                  {t("fixes.selectAll")}
                </label>
                <span className="muted">
                  {t("fixes.selectedCount", { n: selected.size, total: visibleCorrections.length })}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="button primary"
                  disabled={selected.size === 0}
                  onClick={() => setBatchOpen(true)}
                >
                  <IconRefactor /> {t("fixes.fixWithAi", { n: selected.size || "" })}
                </button>
                <InfoTip
                  title="Correção em lote"
                  content="Selecione os achados e gere as correções de uma vez. No fim, você abre um único Pull Request com todas. Ou use “Corrigir com IA” em cada card para uma só."
                />
              </div>
              {visibleCorrections.length === 0 ? (
                <div className="empty-state">
                  {q || sevFilter || srcFilter
                    ? t("fixes.emptyFilters")
                    : statusFilter === "open"
                      ? t("fixes.emptyResolved")
                      : t("fixes.emptyNoResolved")}
                </div>
              ) : (
                <div className="finding-list">
                  {visibleCorrections.map((v) => (
                    <VulnerabilityCard
                      key={v.id}
                      vuln={v}
                      onFix={openFix}
                      selectable
                      selected={selected.has(v.id)}
                      onToggleSelect={toggleOne}
                      status={findingState[v.id]?.status}
                      inherited={findingState[v.id]?.inherited}
                      hasFix={findingState[v.id]?.hasFix}
                      onStatus={
                        findingState[v.id]
                          ? (vuln, status) => void setFindingStatus(vuln.id, status)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

              {hiddenByLimit > 0 && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setLimit((n) => n + PAGE)}
                  >
                    {t("fixes.showMore", { n: Math.min(PAGE, hiddenByLimit), total: hiddenByLimit })}
                  </button>
                </div>
              )}
            </>
          )}

          {review?.unverifiedRules && review.unverifiedRules.length > 0 && (
            <div>
              <h3 className="section-subtitle">
                Regras declaradas que não deu para verificar
              </h3>
              <div className="report-req-list">
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
            </div>
          )}
        </section>
      )}

      {/* ---------- DEPENDÊNCIAS (SCA) ---------- */}
      {tab === "deps" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title-row">
                Dependências · SCA
                <InfoTip
                  title="Dependências (SCA)"
                  content="Pacotes com CVE conhecido detectados pela análise de composição de software. A correção é atualizar para a versão corrigida indicada."
                />
              </h2>
              <p className="muted">Pacotes vulneráveis e a versão que corrige.</p>
            </div>
          </div>

          {notReady("software", "Escaneando as dependências…")}

          {job.phases.software.status === "done" &&
            deps.length === 0 &&
            (scannersRan.deps ? (
              <div className="empty-state">
                Nenhuma dependência vulnerável encontrada. 🎉
              </div>
            ) : (
              <div className="alert error">
                <span>
                  <strong>
                    O SCA ({scan?.sca.engine || "trivy"}) não foi executado.
                  </strong>{" "}
                  {scan?.sca.note || "As dependências não foram verificadas."}
                </span>
              </div>
            ))}

          {deps.length > 0 && (
            <div className="finding-list">
              {deps.map((d) => (
                <DependencyCard key={d.id} dep={d} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---------- AMEAÇAS (Fase 1) ---------- */}
      {tab === "threats" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title-row">
                Modelagem de ameaças
                <InfoTip
                  title="Modelagem de ameaças"
                  content="A IA analisa o contexto do sistema e levanta ameaças plausíveis (STRIDE, LGPD, OWASP) e os requisitos técnicos que as mitigam."
                />
              </h2>
              {plan?.summary && <p className="muted">{plan.summary}</p>}
            </div>
          </div>

          {notReady("plan", "Modelando as ameaças…")}

          {plan && (
            <>
              <div className="finding-list">
                {plan.threats.map((t) => (
                  <article key={t.id} className={`vuln-card sev-${t.severity}-edge`}>
                    <div className="vuln-head">
                      <div className="vuln-title">
                        <span className="badge">{t.category}</span> {t.title}
                      </div>
                      <SeverityBadge severity={t.severity} />
                    </div>
                    <p className="vuln-desc">{t.description}</p>
                  </article>
                ))}
              </div>

              <div>
                <h3 className="section-subtitle">Requisitos técnicos de segurança</h3>
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
            </>
          )}
        </section>
      )}

      {/* ---------- SKILLS (Fase 2) ---------- */}
      {tab === "skills" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title-row">
                Validação de skills
                <InfoTip
                  title="Validação de skills"
                  content="Cada skill/prompt é checada contra prompt-injection, exfiltração de dados e desvio de política. O veredito indica se é seguro usá-la."
                />
              </h2>
              <p className="muted">Segurança de skills/prompts enviados.</p>
            </div>
          </div>

          {notReady("skills", "Validando as skills…")}

          {job.phases.skills.status === "done" &&
            (skills.length ? (
              <div className="finding-list">
                {skills.map((s) => (
                  <SkillFindingCard key={s.skillName} skill={s} />
                ))}
              </div>
            ) : (
              <div className="empty-state">Nenhuma skill enviada para validação.</div>
            ))}
        </section>
      )}

      {selVuln && (
        <FixModal
          key={selVuln.id}
          vuln={selVuln}
          fix={fix}
          loading={fixLoading}
          error={fixError}
          onGenerate={generateFixFor}
          onClose={() => setSelVuln(null)}
          onOpenPR={openPR}
          prState={prState}
          pr={pr}
          canOpenPR={!!job.input.repoUrl}
        />
      )}

      {batchOpen && (
        <BatchFixModal
          vulns={corrections.filter((v) => selected.has(v.id))}
          repoUrl={job.input.repoUrl}
          analysisId={job.id}
          findingIdByLocal={Object.fromEntries(
            Object.entries(findingState).map(([k, f]) => [k, f.id])
          )}
          onPrOpened={(ids) => {
            for (const localId of ids) void setFindingStatus(localId, "pr_open");
          }}
          onClose={() => setBatchOpen(false)}
        />
      )}
    </AppShell>
  );
}
