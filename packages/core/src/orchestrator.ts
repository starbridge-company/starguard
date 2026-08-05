// ============================================================
// O ORQUESTRADOR.
//
// Recebe uma seleção de analisadores e uma origem de código; monta um plano,
// executa o que dá para executar e emite eventos. Não sabe o que é uma linha
// de Postgres, um terminal ou um painel Problemas — quem sabe são os sinks.
//
// Três decisões que valem estar escritas, porque são o que diferencia isto do
// pipeline linear que existia antes:
//
// 1. O PLANO É INSPECIONÁVEL ANTES DE RODAR. `plan()` não executa nada e já
//    responde "o Trivy vai rodar? se não, por quê?". É a mesma resposta que
//    alimenta o cartão desabilitado da tela, o `starguard doctor` e a árvore
//    do VS Code — três interfaces, uma fonte de verdade.
//
// 2. DEPENDÊNCIA É ENRIQUECIMENTO, NÃO PRÉ-REQUISITO. O analisador de regras
//    de negócio fica melhor com o SAST junto (deduplica contra ele) e com a
//    modelagem junto (tem requisitos a conferir). Sem eles, roda mesmo assim e
//    a degradação é REGISTRADA. Se fosse pré-requisito, "só regras de negócio"
//    arrastaria os outros dois — e o pipeline linear voltaria pela porta dos
//    fundos.
//
// 3. FALHA DE UM NÃO DERRUBA OS OUTROS. Já era assim dentro da fase de scan
//    (AUDITORIA.md#UX-15); agora é regra do orquestrador. Binário ausente no
//    SAST não pode apagar os achados do Trivy.
//
// NODE-ONLY.
// ============================================================
import type {
  AnalysisRun,
  Availability,
  Analyzer,
  AnalyzerContext,
  AnalyzerOutcome,
  ExecutionPlan,
  InputKind,
  PlanEntry,
  RunEvent,
  Sink,
  UpstreamResults,
  Workspace,
  WorkspaceSource,
} from "./contracts";
import type { AnalyzerId, Requirement, ThreatModel } from "./types";
import { DEFAULT_LOCALE, type Locale } from "./i18n/config";
import { allAnalyzers, getAnalyzer, resolveSelection } from "./registry";
import { openWorkspace } from "./workspace";
import { redactError } from "./redact";
import { log } from "./logger";

export interface PlanInput {
  /** Ids escolhidos. Ausente ou vazio = todos os que puderem rodar. */
  select?: readonly string[] | "all";
  source?: WorkspaceSource;
  locale?: Locale;
  systemDescription?: string;
  skills?: { name: string; content: string }[];
  /** Quantos analisadores rodam ao mesmo tempo. */
  concurrency?: number;
}

export interface RunOptions {
  sinks?: Sink[];
  signal?: AbortSignal;
  /** Segredos e entradas que o plano não carrega. */
  systemDescription?: string;
  skills?: { name: string; content: string }[];
  source?: WorkspaceSource;
  /** Workspace já aberto por quem chamou (a extensão reaproveita entre rodadas). */
  workspace?: Workspace;
}

/**
 * Monta o plano SEM executar nada.
 *
 * Um analisador entra no plano quando foi escolhido E o `probe` dele diz que o
 * ambiente permite. Ficar de fora sempre tem motivo nomeado — nunca sumir da
 * lista em silêncio, que é o que faria a tela parecer completa quando não é.
 */
export async function plan(input: PlanInput): Promise<ExecutionPlan> {
  const source = input.source ?? { type: "none" as const };
  const escolhidos = new Set(resolveSelection(input.select));
  const temWorkspace = source.type !== "none";

  const entradas: Record<InputKind, boolean> = {
    systemDescription: !!input.systemDescription?.trim(),
    skills: !!input.skills?.length,
  };
  const hasInput = (k: InputKind) => entradas[k];

  const entries: PlanEntry[] = [];
  for (const a of allAnalyzers()) {
    if (!escolhidos.has(a.id)) {
      entries.push({
        id: a.id,
        willRun: false,
        reason: "not_selected",
        missingUpstream: [],
      });
      continue;
    }
    // `probe` não deveria lançar (indisponível é resposta, não erro), mas se
    // lançar o analisador fica de fora em vez de derrubar o plano inteiro.
    const disp: Availability = await a
      .probe({ hasWorkspace: temWorkspace, hasInput })
      .catch(() => ({ ok: false, reason: "binary_missing" }));
    entries.push({
      id: a.id,
      willRun: disp.ok,
      reason: disp.ok ? undefined : disp.reason,
      detail: disp.detail,
      missingUpstream: [],
    });
  }

  // A degradação só é conhecida depois que se sabe quem VAI rodar: um `uses`
  // que não entrou no plano é contexto que faltará.
  const vaiRodar = new Set(entries.filter((e) => e.willRun).map((e) => e.id));
  for (const e of entries) {
    if (!e.willRun) continue;
    const a = getAnalyzer(e.id)!;
    e.missingUpstream = (a.uses ?? []).filter((u) => !vaiRodar.has(u));
  }

  return {
    entries,
    source,
    locale: input.locale ?? DEFAULT_LOCALE,
    concurrency: Math.max(1, input.concurrency ?? 4),
  };
}

/** Emite para todos os sinks. Sink que lança é observador quebrado, não falha da execução. */
async function emit(sinks: Sink[], event: RunEvent): Promise<void> {
  for (const s of sinks) {
    try {
      await s.on(event);
    } catch (e) {
      log.warn("sink.failed", { event: event.type, error: e });
    }
  }
}

/** O que o analisador `id` recebe de contexto vindo de quem já terminou. */
function upstreamFor(
  id: AnalyzerId,
  outcomes: Record<string, AnalyzerOutcome>
): UpstreamResults {
  const a = getAnalyzer(id);
  const usa = new Set(a?.uses ?? []);
  const up: UpstreamResults = {};
  if (usa.has("threat") && outcomes.threat?.status === "done") {
    up.requirements = (outcomes.threat.result as ThreatModel | undefined)
      ?.requirements as Requirement[] | undefined;
  }
  if (usa.has("sast") && outcomes.sast?.status === "done") {
    up.sastFindings = outcomes.sast.result as UpstreamResults["sastFindings"];
  }
  if (usa.has("sca") && outcomes.sca?.status === "done") {
    up.scaFindings = outcomes.sca.result as UpstreamResults["scaFindings"];
  }
  return up;
}

/**
 * Executa o plano.
 *
 * Rodadas de dependência, não fila fixa: tudo o que não espera ninguém sai na
 * primeira rodada, em paralelo. Quem declara `uses` espera só os que estão no
 * MESMO plano — os que não estão já foram contados como degradação e não
 * seguram ninguém. Na prática, `threat`, `sast`, `sca` e `skills` saem juntos
 * e `business` entra depois; pedindo só `business`, ele sai na primeira.
 */
export async function run(
  execPlan: ExecutionPlan,
  opts: RunOptions = {}
): Promise<AnalysisRun> {
  const sinks = opts.sinks ?? [];
  const startedAt = Date.now();
  const outcomes: Record<string, AnalyzerOutcome> = {};

  for (const e of execPlan.entries) {
    if (!e.willRun) {
      outcomes[e.id] = {
        id: e.id,
        status: "skipped",
        reason: e.reason,
        degraded: [],
      };
    }
  }

  await emit(sinks, { type: "run:start", plan: execPlan, at: startedAt });
  for (const e of execPlan.entries) {
    if (!e.willRun && e.reason) {
      await emit(sinks, { type: "analyzer:skipped", id: e.id, reason: e.reason });
    }
  }

  // O workspace é aberto UMA vez e compartilhado por todos. Quem chamou pode
  // passar um já aberto (a extensão do VS Code reaproveita entre execuções, e
  // reabrir o mesmo diretório a cada tecla seria desperdício).
  const source = opts.source ?? execPlan.source;
  const precisaWorkspace = execPlan.entries.some(
    (e) => e.willRun && getAnalyzer(e.id)!.needs.workspace
  );
  let ws: Workspace | undefined = opts.workspace;
  let nossoWorkspace = false;
  try {
    if (!ws && precisaWorkspace) {
      ws = await openWorkspace(source);
      nossoWorkspace = true;
    }

    const pendentes = execPlan.entries.filter((e) => e.willRun).map((e) => e.id);
    const noPlano = new Set(pendentes);
    const concluidos = new Set<AnalyzerId>();

    while (pendentes.length) {
      // Pronto = todo `uses` que está no plano já terminou (com qualquer
      // desfecho: um upstream que falhou é contexto que não veio, e esperar
      // por ele para sempre seria travar a execução por causa de um opcional).
      const prontos = pendentes.filter((id) => {
        const usa = getAnalyzer(id)!.uses ?? [];
        return usa.every((u) => !noPlano.has(u) || concluidos.has(u));
      });

      // Ciclo de `uses` entre analisadores: não deveria existir, mas se um dia
      // alguém criar um, travar em silêncio seria o pior desfecho possível.
      // Roda a rodada mesmo assim, sem o contexto circular.
      const rodada = prontos.length ? prontos : [...pendentes];

      for (const id of rodada) {
        pendentes.splice(pendentes.indexOf(id), 1);
      }

      await inBatches(rodada, execPlan.concurrency, async (id) => {
        const analyzer = getAnalyzer(id)!;
        const entry = execPlan.entries.find((e) => e.id === id)!;
        await runOne(analyzer, entry.missingUpstream, {
          ws,
          execPlan,
          opts,
          outcomes,
          sinks,
        });
        concluidos.add(id);
      });
    }
  } finally {
    if (nossoWorkspace) await ws?.dispose();
  }

  const finishedAt = Date.now();
  const ok = !Object.values(outcomes).some((o) => o.status === "error");
  await emit(sinks, {
    type: "run:done",
    at: finishedAt,
    durationMs: finishedAt - startedAt,
    ok,
  });

  return { plan: execPlan, outcomes, startedAt, finishedAt, ok };
}

async function runOne(
  analyzer: Analyzer,
  degraded: AnalyzerId[],
  env: {
    ws?: Workspace;
    execPlan: ExecutionPlan;
    opts: RunOptions;
    outcomes: Record<string, AnalyzerOutcome>;
    sinks: Sink[];
  }
): Promise<void> {
  const { ws, execPlan, opts, outcomes, sinks } = env;
  const inicio = Date.now();
  await emit(sinks, { type: "analyzer:start", id: analyzer.id, at: inicio });

  const ctx: AnalyzerContext = {
    workspace: analyzer.needs.workspace ? ws : undefined,
    locale: execPlan.locale,
    signal: opts.signal,
    systemDescription: opts.systemDescription,
    skills: opts.skills,
    upstream: upstreamFor(analyzer.id, outcomes),
    report: (message, pct) => {
      void emit(sinks, {
        type: "analyzer:progress",
        id: analyzer.id,
        message,
        pct,
      });
    },
  };

  try {
    const result = await analyzer.run(ctx);
    const fim = Date.now();
    outcomes[analyzer.id] = {
      id: analyzer.id,
      status: "done",
      result,
      degraded,
      startedAt: inicio,
      finishedAt: fim,
    };
    await emit(sinks, {
      type: "analyzer:done",
      id: analyzer.id,
      at: fim,
      durationMs: fim - inicio,
      result,
      degraded,
    });
  } catch (e) {
    const fim = Date.now();
    // Redigido: este texto é PERSISTIDO no JSONB, impresso no terminal e
    // mostrado no editor; erro de ferramenta externa pode carregar credencial.
    // Ver AUDITORIA.md#SEC-01.
    const error = redactError(e);
    outcomes[analyzer.id] = {
      id: analyzer.id,
      status: "error",
      error,
      degraded,
      startedAt: inicio,
      finishedAt: fim,
    };
    await emit(sinks, {
      type: "analyzer:error",
      id: analyzer.id,
      at: fim,
      durationMs: fim - inicio,
      error,
    });
    log.error("analyzer.failed", { engine: analyzer.id, error: e });
  }
}

/** Executa em lotes de `size`, para não abrir N processos de uma vez. */
async function inBatches<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

/** Atalho: monta o plano e executa. É o que as três interfaces chamam. */
export async function analyze(
  input: PlanInput & RunOptions
): Promise<AnalysisRun> {
  const p = await plan(input);
  return run(p, input);
}
