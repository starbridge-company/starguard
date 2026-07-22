"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PipelineStepper, { type PipelineStep } from "@/components/PipelineStepper";
import SectionTabs, { type SectionTab } from "@/components/SectionTabs";
import VulnerabilityCard, { DependencyCard } from "@/components/VulnerabilityCard";
import SkillFindingCard from "@/components/SkillFindingCard";
import SeverityBadge from "@/components/SeverityBadge";
import FixModal from "@/components/FixModal";
import BatchFixModal from "@/components/BatchFixModal";
import InfoTip from "@/components/InfoTip";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { SEVERITY_ORDER, SEVERITY_LABEL_PT } from "@/types";
import type {
  Job,
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

type TabId = "overview" | "code" | "deps" | "threats" | "skills";

const TERMINAL = new Set(["done", "error"]);

function allTerminal(job: Job): boolean {
  return (Object.values(job.phases) as { status: string }[]).every((p) =>
    TERMINAL.has(p.status)
  );
}

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
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const poll = useCallback(async () => {
    try {
      const data = await apiGet<Job>(`/api/status/${id}`);
      setJob(data);
      if (!allTerminal(data)) {
        timer.current = setTimeout(poll, 1400);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar a análise.");
    }
  }, [id]);

  useEffect(() => {
    poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  // Abre o modal SEM gerar — o usuário pode ajustar as instruções antes.
  const openFix = (vuln: Vulnerability) => {
    setSelVuln(vuln);
    setFix(null);
    setFixError(null);
    setPr(null);
    setPrState("idle");
  };

  // Gera (ou refaz) a correção com o prompt personalizado + contexto do erro.
  const generateFixFor = async (instructions: string) => {
    if (!selVuln) return;
    setFix(null);
    setFixError(null);
    setFixLoading(true);
    try {
      const result = await apiPost<FixResult>("/api/step4-fix", {
        vulnerabilityId: selVuln.id,
        file: selVuln.file,
        originalCode: selVuln.codeSnippet || selVuln.description || selVuln.title,
        description: selVuln.description || selVuln.title,
        suggestion: selVuln.suggestion,
        language: guessLang(selVuln.file),
        line: selVuln.line,
        endLine: selVuln.endLine,
        cwe: selVuln.cwe,
        owasp: selVuln.owasp,
        ruleId: selVuln.ruleId,
        repoUrl: job?.input.repoUrl,
        userInstructions: instructions.trim() || undefined,
      });
      setFix(result);
    } catch (err) {
      setFixError(err instanceof ApiError ? err.message : "Falha ao gerar correção.");
    } finally {
      setFixLoading(false);
    }
  };

  const openPR = async () => {
    if (!fix || !job?.input.repoUrl) return;
    setPrState("loading");
    try {
      const result = await apiPost<PullRequest>("/api/github/pr", {
        repoUrl: job.input.repoUrl,
        file: fix.file,
        fixedCode: fix.fixedCode,
        title: `Correção de segurança: ${selVuln?.title || fix.file}`,
        body: fix.explanation,
        analysisId: job.id,
      });
      setPr(result);
      setPrState("done");
    } catch {
      setPrState("idle");
      setFixError("Falha ao abrir o PR.");
    }
  };

  if (error) {
    return (
      <AppShell>
        <div className="alert error">{error}</div>
        <Link href="/" className="button ghost" style={{ width: "fit-content" }}>
          ← Nova análise
        </Link>
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
  const criticalCount = corrections.filter((v) => v.severity === "critical").length;
  const skillsRejected = skills.filter((s) => s.verdict !== "approved").length;

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
      prev.size === corrections.length
        ? new Set()
        : new Set(corrections.map((v) => v.id))
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
    { id: "overview", label: "Visão geral" },
    {
      id: "code",
      label: "Correções",
      count: corrections.length,
      tone: criticalCount > 0 ? "danger" : "accent",
    },
    {
      id: "deps",
      label: "Dependências",
      count: deps.length,
      tone: deps.some((d) => d.severity === "critical" || d.severity === "high")
        ? "warning"
        : "default",
    },
    { id: "threats", label: "Ameaças", count: plan?.threats.length ?? 0 },
    { id: "skills", label: "Skills", count: skills.length },
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
          <span className="page-kicker">Análise · {job.id}</span>
          <h1>{job.input.projectName}</h1>
          <p className="page-subtitle">
            {done
              ? "Análise concluída. Comece pelas correções de código."
              : "Rodando as 4 fases em tempo real…"}
          </p>
        </div>
        <div className="header-actions">
          {!done && (
            <span className="badge primary">
              <span className="dot" /> {job.progress}%
            </span>
          )}
          <Link href={`/report/${job.id}`} className="button ghost">
            <IconReport /> Relatório
          </Link>
          <Link href="/" className="button ghost">
            <IconRefresh /> Nova
          </Link>
        </div>
      </header>

      {!done && (
        <div className="progress-track" aria-label="progresso">
          <div className="progress-fill" style={{ width: `${job.progress}%` }} />
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
                  <span className="muted">{SEVERITY_LABEL_PT[s]}</span>
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

          {notReady("software", "Analisando o código-fonte…")}

          {job.phases.software.status === "done" && corrections.length === 0 && (
            <div className="empty-state">
              Nenhuma correção de segurança encontrada. 🎉
            </div>
          )}

          {corrections.length > 0 && (
            <>
              <div className="finding-toolbar">
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={selected.size === corrections.length}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          selected.size > 0 && selected.size < corrections.length;
                    }}
                    onChange={toggleAll}
                  />
                  Selecionar todas
                </label>
                <span className="muted">
                  {selected.size} de {corrections.length} selecionadas
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="button primary"
                  disabled={selected.size === 0}
                  onClick={() => setBatchOpen(true)}
                >
                  <IconRefactor /> Corrigir {selected.size || ""} com IA
                </button>
                <InfoTip
                  title="Correção em lote"
                  content="Selecione os achados e gere as correções de uma vez. No fim, você abre um único Pull Request com todas. Ou use “Corrigir com IA” em cada card para uma só."
                />
              </div>
              <div className="finding-list">
                {corrections.map((v) => (
                  <VulnerabilityCard
                    key={v.id}
                    vuln={v}
                    onFix={openFix}
                    selectable
                    selected={selected.has(v.id)}
                    onToggleSelect={toggleOne}
                  />
                ))}
              </div>
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

          {job.phases.software.status === "done" && deps.length === 0 && (
            <div className="empty-state">
              Nenhuma dependência vulnerável encontrada. 🎉
            </div>
          )}

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
          onClose={() => setBatchOpen(false)}
        />
      )}
    </AppShell>
  );
}
