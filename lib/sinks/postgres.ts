// ============================================================
// O sink de Postgres — a ponte entre o motor e o banco do painel web.
//
// Este é o ÚNICO arquivo do caminho de análise que sabe o que é Drizzle. O
// orquestrador (`@starguard/core`) emite eventos; aqui eles viram `UPDATE` na
// tabela `analyses` e linhas em `findings`. O terminal e a extensão do VS Code
// rodam o mesmo orquestrador sem nada disto — é justamente por isso que a
// persistência é um sink, e não uma etapa do motor.
//
// Duas obrigações que valem estar escritas:
//
// 1. ESCREVE NO FORMATO ANTIGO. Há análises gravadas com
//    `phases: {plan,skills,software,refactor}`, e o relatório, a exportação e a
//    tela leem essas linhas. `@starguard/core/compat` faz a tradução; aqui só
//    se persiste o resultado dela. Zero migração de dado histórico.
//
// 2. GRAVA A CADA EVENTO, NÃO SÓ NO FIM. A Tela 2 faz polling em
//    `/api/status/[id]` e lê do banco — se o estado só aparecesse no fim, a
//    tela ficaria parada em "pendente" durante a análise inteira.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import type { AnalyzerId, Job, PhaseKey, PhaseState, Severity } from "@/types";
import type { AnalyzerOutcome, RunEvent, Sink } from "@starguard/core/contracts";
import {
  analyzerToPhase,
  phaseAnalyzers,
  phaseStatusFrom,
  reasonKey,
  scanResultFrom,
} from "@starguard/core/compat";
import { AI_BY_PHASE, ENGINES, FIX_AGENT } from "@/lib/config";
import { translate } from "@/lib/i18n/translate";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import * as analysesRepo from "@/lib/repos/analyses";
import * as findingsRepo from "@/lib/repos/findings";
import { log } from "@starguard/core/logger";

function engineLabels(phase: PhaseKey): string[] {
  const ai = AI_BY_PHASE[phase];
  if (phase === "software") return [ENGINES.sast, ENGINES.sca];
  if (phase === "refactor" && ENGINES.fix === "agent")
    return ["claude-code", FIX_AGENT.model || ai.model];
  return [`${ai.provider}`, ai.model];
}

function newPhase<T>(key: PhaseKey, label: string): PhaseState<T> {
  return {
    key,
    label,
    status: "pending",
    ai: AI_BY_PHASE[key],
    engines: engineLabels(key),
  };
}

/**
 * Fases zeradas.
 *
 * `label` é rótulo INTERNO, gravado no JSONB para inspeção do banco; a tela
 * nunca o lê (usa as chaves `pipe.*`, que seguem o idioma). Ver
 * AUDITORIA.md#FEAT-04.
 */
export function initialPhases(): Job["phases"] {
  return {
    plan: newPhase("plan", "Plan · Modelagem de ameaças"),
    skills: newPhase("skills", "Code · Validação de Skills"),
    software: newPhase("software", "Code · Scan do software"),
    refactor: newPhase("refactor", "Refactor · Correção"),
  };
}

/**
 * Progresso = fases efetivamente CONCLUÍDAS, sobre as SELECIONADAS.
 *
 * Gravar 100 no fim mesmo com fase em erro fazia a lista mostrar "100%" ao
 * lado de "erro" — duas informações que se contradizem (AUDITORIA.md#BUG-21).
 * O denominador mudou junto com o fluxo seletivo: quem pediu só o Trivy não
 * pode ver "25% · concluído", que seria a mesma contradição ao contrário. Fase
 * `skipped` não entra na conta de cima nem na de baixo.
 */
export function computeProgress(phases: Job["phases"]): number {
  const todas = Object.values(phases) as PhaseState[];
  const selecionadas = todas.filter((p) => p.status !== "skipped");
  if (!selecionadas.length) return 100;
  const prontas = selecionadas.filter((p) => p.status === "done").length;
  return Math.round((prontas / selecionadas.length) * 100);
}

// `prsCount` fica de fora de propósito: quem o mantém é o repositório de PRs,
// que incrementa a cada PR aberto. Recalculá-lo aqui zeraria o contador, já
// que `phases.refactor.prs` está sempre vazio. Ver AUDITORIA.md#BUG-08.
export function computeMetrics(
  phases: Job["phases"]
): Omit<analysesRepo.AnalysisMetrics, "prsCount"> {
  const scan = phases.software.result;
  const refactor = phases.refactor.result;
  const sast = scan?.sast.vulnerabilities ?? [];
  const sca = scan?.sca.dependencies ?? [];
  const review = scan?.review?.findings ?? [];
  const sev = (s: Severity) =>
    sast.filter((v) => v.severity === s).length +
    review.filter((v) => v.severity === s).length +
    sca.filter((d) => d.severity === s).length;
  return {
    criticalCount: sev("critical"),
    highCount: sev("high"),
    mediumCount: sev("medium"),
    lowCount: sev("low"),
    infoCount: sev("info"),
    sastCount: sast.length,
    scaCount: sca.length,
    reviewCount: review.length,
    fixesCount: refactor?.fixes.length ?? 0,
    totalFindings: sast.length + sca.length + review.length,
  };
}

export interface PostgresSinkOptions {
  analysisId: string;
  userId: string;
  locale: Locale;
  repoUrl?: string;
  /** Analisadores escolhidos — grava na linha para a tela saber o que pedir. */
  selected: AnalyzerId[];
}

/**
 * Sink que mantém a linha da análise em dia conforme os eventos chegam.
 *
 * Guarda as fases em memória e regrava o JSONB inteiro a cada mudança. É o
 * mesmo que a versão anterior fazia entre as fases; o que mudou é que agora a
 * granularidade é o ANALISADOR, então a fase `software` é reescrita três vezes
 * (uma por analisador que a compõe) em vez de uma só no fim.
 */
export function postgresSink(opts: PostgresSinkOptions): Sink & {
  phases: Job["phases"];
} {
  const phases = initialPhases();
  const outcomes: Record<string, AnalyzerOutcome> = {};

  // As fases que nenhum analisador selecionado alimenta já nascem `skipped`:
  // sem isto elas ficariam `pending` para sempre e a tela mostraria uma
  // análise concluída com etapas aparentemente travadas.
  const selecionados = new Set(opts.selected);
  for (const key of Object.keys(phases) as PhaseKey[]) {
    const ids = phaseAnalyzers(key);
    if (key === "refactor") {
      // A correção não roda na análise desde o BUG-16: sai sob demanda.
      phases.refactor.status = "skipped";
      continue;
    }
    if (!ids.some((id) => selecionados.has(id))) {
      phases[key].status = "skipped";
      phases[key].error = translate(opts.locale, "analyzer.reason.not_selected");
    }
  }

  const persist = () =>
    analysesRepo
      .patchAnalysis(opts.analysisId, {
        phases,
        progress: computeProgress(phases),
      })
      .catch(() => {
        /* falha de persistência não pode derrubar a análise em andamento */
      });

  /** Recalcula a fase a que o analisador pertence, a partir dos desfechos. */
  const refreshPhase = (id: AnalyzerId) => {
    const key = analyzerToPhase(id);
    const ph = phases[key] as PhaseState<unknown>;
    const irmaos = phaseAnalyzers(key)
      .map((x) => outcomes[x])
      .filter(Boolean);

    ph.status = phaseStatusFrom(irmaos);
    const errado = irmaos.find((o) => o.status === "error");
    ph.error = errado?.error;
    ph.startedAt = irmaos.map((o) => o.startedAt).filter(Boolean).sort()[0];
    ph.finishedAt = irmaos
      .map((o) => o.finishedAt)
      .filter(Boolean)
      .sort()
      .pop();

    if (key === "software") {
      // As três seções (sast, sca, review) saem dos desfechos, cada uma com o
      // seu `ran` e a sua nota. É o que impede a tela de comemorar "nenhuma
      // vulnerabilidade 🎉" sobre um analisador que não rodou (UX-15).
      ph.result = scanResultFrom(outcomes, opts.locale);
    } else {
      const o = outcomes[id];
      if (o?.status === "done") ph.result = o.result;
    }
  };

  return {
    phases,

    async on(event: RunEvent) {
      switch (event.type) {
        case "run:start":
          await analysesRepo
            .patchAnalysis(opts.analysisId, {
              status: "running",
              startedAt: new Date(),
            })
            .catch(() => {});
          break;

        case "analyzer:skipped":
          outcomes[event.id] = {
            id: event.id,
            status: "skipped",
            reason: event.reason,
            degraded: [],
          };
          refreshPhase(event.id);
          await persist();
          break;

        case "analyzer:start": {
          const key = analyzerToPhase(event.id);
          // `running` só se a fase ainda não terminou por outro analisador:
          // com sast, sca e business na mesma fase, o último a começar não
          // pode reabrir o que os outros já fecharam.
          if (phases[key].status !== "done" && phases[key].status !== "error") {
            phases[key].status = "running";
            phases[key].startedAt ??= event.at;
          }
          await persist();
          break;
        }

        case "analyzer:done":
          outcomes[event.id] = {
            id: event.id,
            status: "done",
            result: event.result,
            degraded: event.degraded,
            startedAt: event.at - event.durationMs,
            finishedAt: event.at,
          };
          refreshPhase(event.id);
          await persist();
          await persistFindings(opts, phases);
          break;

        case "analyzer:error":
          outcomes[event.id] = {
            id: event.id,
            status: "error",
            error: event.error,
            degraded: [],
            startedAt: event.at - event.durationMs,
            finishedAt: event.at,
          };
          refreshPhase(event.id);
          await persist();
          break;

        case "run:done": {
          const algumErro = (Object.values(phases) as PhaseState[]).some(
            (p) => p.status === "error"
          );
          await analysesRepo
            .patchAnalysis(opts.analysisId, {
              phases,
              progress: computeProgress(phases),
              status: algumErro ? "error" : "done",
              finishedAt: new Date(),
              metrics: computeMetrics(phases),
            })
            .catch((e) =>
              log.error("sink.finalize.failed", { jobId: opts.analysisId, error: e })
            );
          break;
        }
      }
    },
  };
}

/**
 * Cada achado vira uma linha com estado próprio, herdando o que já foi
 * resolvido em análises anteriores do mesmo repositório.
 *
 * Falhar aqui não pode derrubar a análise — o JSONB `phases` continua sendo a
 * fonte dos dados; a tabela é o que dá memória. Ver AUDITORIA.md#FEAT-01.
 */
async function persistFindings(
  opts: PostgresSinkOptions,
  phases: Job["phases"]
): Promise<void> {
  const scan = phases.software.result;
  if (!scan) return;
  await findingsRepo
    .persistScanFindings(opts.analysisId, opts.userId, opts.repoUrl || null, scan)
    .then((herdados) => {
      if (herdados > 0) {
        log.info("findings.inherited", { jobId: opts.analysisId, count: herdados });
      }
    })
    .catch((e) =>
      log.error("findings.persist.failed", { jobId: opts.analysisId, error: e })
    );
}

/** Motivo legível de indisponibilidade, no idioma da análise. */
export function unavailableText(
  locale: Locale = DEFAULT_LOCALE,
  reason: Parameters<typeof reasonKey>[0],
  bin?: string
): string {
  return translate(locale, reasonKey(reason), { bin: bin ?? "" }).trim();
}
