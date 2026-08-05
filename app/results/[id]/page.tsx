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
import ExportMenu from "@/components/ExportMenu";
import { apiPost, ApiError } from "@/lib/client";
import { useAnalysisPolling, allTerminal } from "@/lib/useAnalysisPolling";
import { useFindings, isResolved } from "@/lib/useFindings";
import { useRepoVisibility } from "@/lib/useRepoVisibility";
import { collidesWithSast } from "@/lib/dedup";
import { clampFix, clampPrBody, clampPrTitle } from "@/lib/validation";
import { type TokenChoice } from "@/components/TokenPrompt";
import {
  canFixDependency,
  dependencyAsFixTarget,
  dependencyFixTitle,
  lockfileWarning,
} from "@/lib/deps-fix";
import { Segmented, SearchBox } from "@/components/filters";
import { buildResultsTabs, type TabId } from "@/lib/results-tabs";
import { useApiError, useT, type MessageKey } from "@/lib/i18n";

import { SEVERITY_ORDER } from "@/types";
import type {
  Vulnerability,
  DependencyVuln,
  FixTarget,
  FixResult,
  PullRequest,
  PhaseKey,
  Severity,
  StepStatus,
} from "@/types";
import {
  IconReport,
  IconRefresh,
  IconWarn as IconAlert,
  IconRefactor,
  IconPlan,
  IconSkills,
  IconScan,
  IconPackage,
  IconChevronRight,
} from "@/lib/icons";

/** Cards renderizados por vez na aba de correções. */
const PAGE = 25;

// Nome legível da fase, reaproveitando as chaves do PipelineStepper.
const PHASE_NAME: Record<PhaseKey, MessageKey> = {
  plan: "pipe.plan.short",
  skills: "pipe.skills.short",
  software: "pipe.software.short",
  refactor: "pipe.refactor.short",
};

// Estado da fase em minúsculas, para aparecer no meio de uma frase da visão
// geral ("Correções · rodando…"). O stepper usa `pipe.status.*`, capitalizado.
const PHASE_STATUS_KEY: Record<StepStatus, MessageKey> = {
  running: "phase.running",
  pending: "phase.pending",
  error: "phase.error",
  done: "phase.done",
  skipped: "phase.skipped",
};

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

  const apiError = useApiError();
  const [tab, setTab] = useState<TabId>("overview");

  // Estado do fluxo de correção individual (FixModal).
  const [selVuln, setSelVuln] = useState<FixTarget | null>(null);
  const [fix, setFix] = useState<FixResult | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [prState, setPrState] = useState<"idle" | "loading" | "done">("idle");
  const [pr, setPr] = useState<PullRequest | null>(null);
  // Preenchido quando o PR falha por falta de token — a tela pede na hora em
  // vez de mostrar um erro que o usuário não sabe resolver.
  const [needToken, setNeedToken] = useState<string | null>(null);
  const { isPrivate: repoIsPrivate } = useRepoVisibility(job?.input.repoUrl);

  // Seleção para correção em lote.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  // Seleção da aba de Dependências, separada da de Correções: são listas
  // diferentes e marcar numa não pode arrastar a outra.
  const [selectedDeps, setSelectedDeps] = useState<Set<string>>(new Set());
  const [depsBatchOpen, setDepsBatchOpen] = useState(false);

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
  // Esconder os achados de confiança média com um clique — o palpite da IA não
  // pode custar o mesmo tempo de triagem que uma certeza. Ver AUDITORIA.md#UX-07.
  const [confFilter, setConfFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // Abre o modal SEM gerar — o usuário pode ajustar as instruções antes.
  // Se já houver correção guardada para este achado, ela é CARREGADA (não
  // regerada): era exatamente aqui que se queimava IA à toa a cada reabertura.
  // Ver AUDITORIA.md#FEAT-02.
  const openFix = (vuln: FixTarget) => {
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
    vuln: FixTarget,
    instructions: string,
    force: boolean
  ) => {
    setFix(null);
    setFixError(null);
    setFixLoading(true);
    try {
      const result = await apiPost<FixResult>("/api/step4-fix", {
        findingId: findingState[vuln.id]?.id,
        analysisId: id,
        force,
        vulnerabilityId: vuln.id,
        file: vuln.file,
        // Cortado antes de enviar: mensagem de scanner e trecho de código não
        // têm tamanho garantido, e um texto fora do comum não pode derrubar a
        // geração inteira.
        originalCode: clampFix(
          "originalCode",
          vuln.codeSnippet || vuln.description || vuln.title
        ),
        description: clampFix("description", vuln.description || vuln.title),
        suggestion: clampFix("suggestion", vuln.suggestion),
        language: guessLang(vuln.file),
        line: vuln.line,
        endLine: vuln.endLine,
        cwe: vuln.cwe,
        owasp: vuln.owasp,
        ruleId: vuln.ruleId,
        repoUrl: job?.input.repoUrl,
        userInstructions: clampFix(
          "userInstructions",
          instructions.trim() || undefined
        ),
      });
      setFix(result);
      if (!force) void reloadFindings(); // pode ter passado a existir correção
    } catch (err) {
      setFixError(apiError(err, "fix.failed"));
    } finally {
      setFixLoading(false);
    }
  };

  const generateFixFor = (instructions: string) => {
    if (!selVuln) return;
    // Já existe correção na tela => o botão é "Refazer" => gasta IA de novo.
    void runFix(selVuln, instructions, !!fix);
  };

  const openPR = async (tokenChoice?: TokenChoice) => {
    if (!fix || !job?.input.repoUrl || fix.noChange) return;
    setPrState("loading");
    setNeedToken(null);
    try {
      // Dependência tem título próprio ("chore(deps): pacote a → b") e um
      // aviso que PRECISA ir no corpo: o agente edita o manifesto mas não
      // regera o lockfile — ele não executa comandos, por desenho. Um PR com
      // manifesto novo e lock velho quebra o `npm ci` de quem recebe.
      const depAlvo = deps.find((d) => d.id === selVuln?.id);
      // Título e corpo são texto NOSSO — o título do achado pode ser um
      // parágrafo inteiro vindo do scanner. Cortar aqui evita que o PR seja
      // recusado depois de a correção já estar gerada e paga.
      const title = clampPrTitle(
        depAlvo
          ? dependencyFixTitle(depAlvo)
          : t("pr.fixTitle", { title: selVuln?.title || fix.file })
      );
      const avisoLock = depAlvo ? lockfileWarning(depAlvo) : null;
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
              body: clampPrBody(
                [
                  fix.explanation,
                  `\n${t("pr.changedFiles", {
                    files: changed.map((c) => `\`${c.file}\``).join(", "),
                  })}`,
                  avisoLock ? `\n> ⚠️ ${t(avisoLock.key, avisoLock.values)}` : "",
                ]
                  .filter(Boolean)
                  .join("\n")
              ),
              analysisId: job.id,
              ...tokenChoice,
            })
          : await apiPost<PullRequest>("/api/github/pr", {
              repoUrl: job.input.repoUrl,
              file: fix.file,
              fixedCode: fix.fixedCode,
              title,
              body: clampPrBody(
                avisoLock
                  ? `${fix.explanation}\n\n> ⚠️ ${t(avisoLock.key, avisoLock.values)}`
                  : fix.explanation
              ),
              analysisId: job.id,
              ...tokenChoice,
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
      // Token ausente tem tratamento próprio: a correção já está gerada e
      // guardada, então basta informar o token e repetir — sem gastar IA.
      if (err instanceof ApiError && err.key === "err.githubTokenRequired") {
        setNeedToken(err.message);
        return;
      }
      setFixError(apiError(err, "fix.failed"));
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
            {t("results.newAnalysisLink")}
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
  // Correções, deduplicados contra o SAST — para não repetir uma correção que
  // já está lá. A regra mora em `lib/dedup.ts` e é a MESMA que o servidor
  // aplica; manter duas cópias divergentes é o AUDITORIA.md#ARQ-10.
  const aiFindings = reviewFindings.filter((r) => !collidesWithSast(r, vulns));
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
    // Achado do SAST não tem `confidence`; o filtro só age sobre os da IA.
    if (confFilter === "high" && v.confidence === "medium") return false;
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
        ? scan.sast.note || t("scan.sastNotRun", { engine: scan.sast.engine })
        : "",
      scan && !scan.review?.ran && scan.review?.note ? scan.review.note : "",
    ].filter(Boolean),
  };

  const stepMetrics = (key: PhaseKey) => {
    if (key === "plan" && plan)
      return [
        { label: t("metric.threats"), value: plan.threats.length },
        { label: t("metric.requirements"), value: plan.requirements.length },
      ];
    if (key === "skills" && job.phases.skills.status === "done")
      return [
        { label: t("metric.skills"), value: skills.length },
        { label: t("metric.rejected"), value: skillsRejected },
      ];
    if (key === "software" && scan)
      return [
        { label: t("metric.sast"), value: vulns.length },
        { label: t("metric.ai"), value: aiFindings.length },
        { label: t("metric.sca"), value: deps.length },
      ];
    // A Fase 4 não gera mais correção automática (AUDITORIA.md#BUG-16): exibir
    // "correções 0 · PRs 0" em toda análise seria ruído, não informação.
    if (key === "refactor" && refactor && (refactor.fixes.length || refactor.prs.length))
      return [
        { label: t("metric.fixes"), value: refactor.fixes.length },
        { label: t("metric.prs"), value: refactor.prs.length },
      ];
    return [];
  };

  const done = allTerminal(job);

  // Fases que falharam e para onde levar quem clicar. Ver AUDITORIA.md#UX-16.
  const failedPhases = (["plan", "skills", "software", "refactor"] as PhaseKey[])
    .map((k) => job.phases[k])
    .filter((p) => p.status === "error");
  const PHASE_TAB: Partial<Record<PhaseKey, TabId>> = {
    plan: "threats",
    skills: "skills",
    software: "code",
    refactor: "code",
  };
  const failedTab = failedPhases.length
    ? PHASE_TAB[failedPhases[0]!.key]
    : undefined;

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

  // Duas seleções DIFERENTES, de propósito.
  //
  // "Da página" age só sobre o que está renderizado (a lista mostra 25 por
  // vez); "todas" age sobre tudo que passou pelos filtros, mesmo o que ainda
  // não foi desenhado. Com 576 achados num repositório real, tratar as duas
  // como a mesma coisa é a diferença entre selecionar 25 e selecionar 576 —
  // e cada uma dessas é uma chamada de IA.
  const pageIds = visibleCorrections.map((v) => v.id);
  const allIds = filteredCorrections.map((v) => v.id);

  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const allSelected =
    allIds.length > 0 && allIds.length === selected.size &&
    allIds.every((id) => selected.has(id));

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      // Desmarcar a página não pode limpar o que foi escolhido em outra.
      if (pageAllSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const toggleEverything = () =>
    setSelected(allSelected ? new Set() : new Set(allIds));

  // ---- Correção de dependência ----
  // Só entram na seleção as que TÊM correção possível: marcar uma dependência
  // sem versão corrigida publicada só geraria uma chamada de IA para descobrir
  // que não há o que fazer.
  const depsFixable = deps.filter(canFixDependency);
  const depsPageAllSelected =
    depsFixable.length > 0 && depsFixable.every((d) => selectedDeps.has(d.id));

  const toggleDep = (d: DependencyVuln) =>
    setSelectedDeps((prev) => {
      const next = new Set(prev);
      if (next.has(d.id)) next.delete(d.id);
      else next.add(d.id);
      return next;
    });

  const toggleDepsPage = () =>
    setSelectedDeps(
      depsPageAllSelected ? new Set() : new Set(depsFixable.map((d) => d.id))
    );

  // Reaproveita o MESMO modal e a mesma rota das correções de código: o que
  // muda é o alvo (manifesto em vez de arquivo de código) e as instruções,
  // que já vêm prontas e determinísticas de `lib/deps-fix.ts`.
  const openDepFix = (d: DependencyVuln) => openFix(dependencyAsFixTarget(d));

  const sevCount = (s: Severity) =>
    corrections.filter((v) => v.severity === s).length +
    deps.filter((d) => d.severity === s).length;

  const statusText = (status: StepStatus) =>
    t(PHASE_STATUS_KEY[status]);

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
      return <div className="empty-state">{t("results.waitingPrevious")}</div>;
    // Não pedido nesta análise: a aba continua existindo (o layout não dança
    // entre uma análise e outra) e diz o motivo. Cair no estado vazio genérico
    // aqui mostraria "nenhuma ameaça encontrada 🎉" sobre algo que ninguém
    // analisou — o mesmo engano que o UX-15 corrigiu no scan.
    if (st === "skipped")
      return (
        <div className="empty-state">
          {job.phases[key].error || t("select.notRunHere")}
        </div>
      );
    if (st === "error")
      return <div className="alert error">{job.phases[key].error || t("results.phaseFailed")}</div>;
    return null;
  };

  // A montagem (e a regra de qual aba carrega contador) mora em
  // `lib/results-tabs.ts`, onde tem teste. Aqui só aplicamos o idioma.
  const tabs: SectionTab[] = buildResultsTabs({
    corrections: corrections.length,
    criticals: criticalCount,
  }).map(({ labelKey, ...tab }) => ({ ...tab, label: t(labelKey) }));

  const overviewRows = [
    {
      id: "code" as TabId,
      Icon: IconScan,
      label: t("results.rowFixes"),
      value: scan
        ? t("results.nFixes", { n: corrections.length })
        : statusText(job.phases.software.status),
    },
    {
      id: "deps" as TabId,
      Icon: IconPackage,
      label: t("results.rowDeps"),
      value: scan
        ? t("results.nCves", { n: deps.length })
        : statusText(job.phases.software.status),
    },
    {
      id: "threats" as TabId,
      Icon: IconPlan,
      label: t("results.rowRequirements"),
      value: plan
        ? t("results.nThreats", { threats: plan.threats.length, reqs: plan.requirements.length })
        : statusText(job.phases.plan.status),
    },
    {
      id: "skills" as TabId,
      Icon: IconSkills,
      label: t("results.rowSkills"),
      value:
        job.phases.skills.status === "done"
          ? t("results.nSkills", { n: skills.length })
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
          {/* Levar os achados para fora: SARIF sobe direto no GitHub Code
              Scanning, CSV vai para planilha, JSON para pipeline.
              Ver AUDITORIA.md#UX-10. */}
          <ExportMenu analysisId={job.id} disabled={!scan} />
          <Link href="/" className="button ghost">
            <IconRefresh /> {t("common.new")}
          </Link>
        </div>
      </header>

      {!done && (
        <div className="progress-track" aria-label={t("results.progressLabel")}>
          <div className="progress-fill" style={{ width: `${job.progress}%` }} />
        </div>
      )}

      {/* Fase que falhou no meio do caminho. O PipelineStepper já ficava
          vermelho, mas quem está na aba "Visão geral" não olhava para ele —
          e seguia lendo um resultado incompleto sem saber. A faixa fica no
          topo, é persistente e leva para a aba certa.
          Ver AUDITORIA.md#UX-16. */}
      {failedPhases.length > 0 && (
        <div className="alert error phase-banner" role="status">
          <IconAlert />
          <span>
            <strong>
              {t("results.phasesFailed", { n: failedPhases.length })}
            </strong>{" "}
            {failedPhases.map((p) => t(PHASE_NAME[p.key])).join(" · ")}
            {failedPhases[0]?.error ? ` — ${failedPhases[0].error}` : ""}
          </span>
          {failedTab && (
            <button
              type="button"
              className="button ghost small"
              style={{ marginLeft: "auto" }}
              onClick={() => setTab(failedTab)}
            >
              {t("results.goToPhase")}
            </button>
          )}
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
                {t("tab.overview")}
                <InfoTip
                  title={t("help.overview")}
                  content={t("help.overviewText")}
                />
              </h2>
              <p className="muted">
                {done ? t("results.done") : t("results.inProgress")}
              </p>
            </div>
          </div>

          {corrections.length > 0 && (
            <div className="cta-banner">
              <div className="cta-text">
                <strong>
                  {t("results.ctaTitle", { n: corrections.length })}
                </strong>
                <span className="muted">
                  {t("results.ctaSub", { n: criticalCount })}
                </span>
              </div>
              <button
                type="button"
                className="button primary large"
                onClick={() => setTab("code")}
              >
                <IconRefactor /> {t("results.goToFixes")}
              </button>
            </div>
          )}

          <div>
            <h3 className="section-subtitle">{t("results.bySeverity")}</h3>
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
            <h3 className="section-subtitle">{t("results.sections")}</h3>
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
                {t("tab.fixes")}
                <InfoTip
                  title={t("help.fixes")}
                  content={t("help.fixesText")}
                />
              </h2>
              <p className="muted">
                {t("results.selectItems")}{" "}
                {aiFindings.length > 0 ? (
                  <>
                    {" "}
                    {t("results.includesAi", { n: aiFindings.length })}
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
                {t("fixes.coverage", {
                  reviewed: review.coverage.filesReviewed,
                  eligible: review.coverage.filesEligible,
                })}
                {review.coverage.truncatedFiles > 0
                  ? ` ${t("fixes.coverageTruncated", {
                      n: review.coverage.truncatedFiles,
                    })}`
                  : ""}
              </span>
            </div>
          )}

          {job.phases.software.status === "done" &&
            corrections.length === 0 &&
            (scannersRan.code ? (
              <div className="empty-state">{t("fixes.empty")}</div>
            ) : (
              // "Nada encontrado" e "nada foi procurado" são coisas MUITO
              // diferentes num produto de segurança. Ver AUDITORIA.md#UX-15.
              <div className="alert error">
                <span>
                  {t("fixes.noScanner", {
                    reasons: scannersRan.reasons.join(" "),
                  })}
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
                  ariaLabel={t("filter.severity")}
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
                  ariaLabel={t("filter.source")}
                />
                {/* Só aparece quando há o que filtrar: sem achado de confiança
                    média, o controle seria decoração. Ver AUDITORIA.md#UX-07. */}
                {corrections.some((v) => v.confidence === "medium") && (
                  <Segmented
                    options={[
                      { value: "", label: t("filter.confidenceAll") },
                      { value: "high", label: t("filter.confidenceHigh") },
                    ]}
                    value={confFilter}
                    onChange={(v) => {
                      setConfFilter(v);
                      setLimit(PAGE);
                    }}
                    ariaLabel={t("filter.confidence")}
                  />
                )}
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
                  ariaLabel={t("filter.byStatus")}
                />
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          !pageAllSelected &&
                          pageIds.some((id) => selected.has(id));
                    }}
                    onChange={togglePage}
                  />
                  {t("fixes.selectPage", { n: pageIds.length })}
                </label>

                {/* Só aparece quando há mais do que a página mostra — senão os
                    dois botões fariam exatamente a mesma coisa. */}
                {allIds.length > pageIds.length && (
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={toggleEverything}
                  >
                    {allSelected
                      ? t("fixes.clearAll")
                      : t("fixes.selectAllFiltered", { n: allIds.length })}
                  </button>
                )}

                <span className="muted">
                  {t("fixes.selectedCount", { n: selected.size, total: allIds.length })}
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
                  title={t("help.batch")}
                  content={t("help.batchText")}
                />
              </div>
              {visibleCorrections.length === 0 ? (
                <div className="empty-state">
                  {q || sevFilter || srcFilter || confFilter
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
                      repoUrl={job.input.repoUrl}
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
                {t("unverified.title")}
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
                {t("deps.title")}
                <InfoTip
                  title={t("help.deps")}
                  content={t("help.depsText")}
                />
              </h2>
              <p className="muted">{t("deps.subtitle")}</p>
            </div>
          </div>

          {notReady("software", t("deps.scanning"))}

          {job.phases.software.status === "done" &&
            deps.length === 0 &&
            (scannersRan.deps ? (
              <div className="empty-state">
                {t("deps.empty")}
              </div>
            ) : (
              <div className="alert error">
                <span>
                  <strong>
                    {t("deps.notRun", { engine: scan?.sca.engine || "trivy" })}
                  </strong>{" "}
                  {scan?.sca.note || t("deps.notRunHint")}
                </span>
              </div>
            ))}

          {deps.length > 0 && (
            <>
              {/* Correção de dependência é possível quando o upstream publicou
                  versão corrigida E sabemos o manifesto. As demais aparecem
                  na lista, mas sem botão — e o card diz o porquê. */}
              {depsFixable.length > 0 && (
                <div className="finding-toolbar">
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={depsPageAllSelected}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            !depsPageAllSelected &&
                            depsFixable.some((d) => selectedDeps.has(d.id));
                      }}
                      onChange={toggleDepsPage}
                    />
                    {t("deps.selectPage", { n: depsFixable.length })}
                  </label>
                  <span className="muted">
                    {t("fixes.selectedCount", {
                      n: selectedDeps.size,
                      total: depsFixable.length,
                    })}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="button primary"
                    disabled={selectedDeps.size === 0}
                    onClick={() => setDepsBatchOpen(true)}
                  >
                    <IconRefactor />{" "}
                    {t("deps.fixSelected", { n: selectedDeps.size || "" })}
                  </button>
                </div>
              )}

              <div className="finding-list">
                {deps.map((d) => (
                  <DependencyCard
                    key={d.id}
                    dep={d}
                    onFix={openDepFix}
                    selectable
                    selected={selectedDeps.has(d.id)}
                    onToggleSelect={toggleDep}
                    hasFix={findingState[d.id]?.hasFix}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------- AMEAÇAS (Fase 1) ---------- */}
      {tab === "threats" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title-row">
                {t("help.threats")}
                <InfoTip
                  title={t("help.threats")}
                  content={t("help.threatsText")}
                />
              </h2>
              {plan?.summary && <p className="muted">{plan.summary}</p>}
            </div>
          </div>

          {notReady("plan", t("threats.modeling"))}

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
                <h3 className="section-subtitle">{t("threats.requirements")}</h3>
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
                {t("help.skills")}
                <InfoTip
                  title={t("help.skills")}
                  content={t("help.skillsText")}
                />
              </h2>
              <p className="muted">{t("skills.subtitle")}</p>
            </div>
          </div>

          {notReady("skills", t("skills.validating"))}

          {job.phases.skills.status === "done" &&
            (skills.length ? (
              <div className="finding-list">
                {skills.map((s) => (
                  <SkillFindingCard key={s.skillName} skill={s} />
                ))}
              </div>
            ) : (
              <div className="empty-state">{t("skills.empty")}</div>
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
          onOpenPR={() => void openPR()}
          prState={prState}
          pr={pr}
          canOpenPR={!!job.input.repoUrl}
          needToken={needToken}
          repoIsPrivate={repoIsPrivate}
          onRetryWithToken={(escolha) => void openPR(escolha)}
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

      {/* Lote de dependências: mesmo modal, mesma rota. Cada dependência vira
          um alvo com o manifesto como arquivo — e o agrupamento por arquivo do
          BatchFixModal passa a agir a favor: várias dependências do MESMO
          manifesto entram numa correção só, que é exatamente o certo (um
          package.json não pode ser reescrito duas vezes em paralelo). */}
      {depsBatchOpen && (
        <BatchFixModal
          vulns={depsFixable
            .filter((d) => selectedDeps.has(d.id))
            .map(dependencyAsFixTarget)}
          repoUrl={job.input.repoUrl}
          analysisId={job.id}
          findingIdByLocal={Object.fromEntries(
            Object.entries(findingState).map(([k, f]) => [k, f.id])
          )}
          onPrOpened={(ids) => {
            for (const localId of ids) void setFindingStatus(localId, "pr_open");
          }}
          onClose={() => setDepsBatchOpen(false)}
        />
      )}
    </AppShell>
  );
}
