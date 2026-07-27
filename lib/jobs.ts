// ============================================================
// Orquestração das 4 fases + persistência no Postgres.
// /api/analyze cria a linha (status pending) e dispara runJob (fire-and-forget);
// a Tela 2 faz polling em /api/status/[id] (lê do BD). Segredos (token do
// GitHub decifrado + conteúdo das skills) vivem APENAS num mapa em memória
// durante o job e são apagados no fim — nunca são persistidos.
// ============================================================
import "server-only";
import { AI_BY_PHASE, ENGINES, FIX_AGENT, engineSummary } from "@/lib/config";
import { generateThreatModel, validateSkills, runScan } from "@/lib/tasks";
import { audit } from "@/lib/auth";
import { redactError } from "@/lib/redact";
import { log, timed } from "@/lib/logger";
import * as analysesRepo from "@/lib/repos/analyses";
import * as tokensRepo from "@/lib/repos/tokens";
import * as findingsRepo from "@/lib/repos/findings";
import type { Locale } from "@/lib/i18n/config";
import type {
  Job,
  JobInput,
  JobInputPublic,
  PhaseKey,
  PhaseState,
  Severity,
} from "@/types";

// Segredos transitórios (nunca vão ao BD).
interface Transient {
  systemDescription: string;
  /** Idioma do usuário no momento da criação — o job roda destacado da
   *  requisição, então precisa carregar essa informação junto. */
  locale?: Locale;
  repoUrl?: string;
  token?: string;
  skills: { name: string; content: string }[];
}

const g = globalThis as unknown as { __sg_secrets?: Map<string, Transient> };
g.__sg_secrets ||= new Map();
const secrets = g.__sg_secrets!;

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

function initialPhases(): Job["phases"] {
  return {
    plan: newPhase("plan", "Plan · Modelagem de ameaças"),
    skills: newPhase("skills", "Code · Validação de Skills"),
    software: newPhase("software", "Code · Scan do software"),
    refactor: newPhase("refactor", "Refactor · Correção"),
  };
}

/**
 * Resolve o token a usar: por id de token salvo (decifra) ou token inline.
 * Se pediram para salvar um token novo, persiste cifrado (best-effort).
 */
async function resolveToken(
  userId: string,
  input: {
    token?: string;
    tokenId?: string;
    saveToken?: boolean;
    tokenName?: string;
  }
): Promise<string | undefined> {
  if (input.tokenId) {
    const plain = await tokensRepo.getDecrypted(userId, input.tokenId);
    return plain ?? undefined;
  }
  if (input.token && input.saveToken && input.tokenName) {
    try {
      await tokensRepo.createToken(userId, input.tokenName, input.token);
    } catch {
      /* salvar o token não pode derrubar a análise */
    }
  }
  return input.token || undefined;
}

export interface CreateAnalysisInput extends JobInput {
  locale?: Locale;
  tokenId?: string;
  saveToken?: boolean;
  tokenName?: string;
}

/** Cria a análise no BD (status pending) e guarda os segredos em memória. */
export async function createAnalysis(
  userId: string,
  input: CreateAnalysisInput
): Promise<string> {
  const token = await resolveToken(userId, input);
  const id = await analysesRepo.createAnalysis({
    userId,
    projectName: input.projectName,
    systemDescription: input.systemDescription,
    repoUrl: input.repoUrl || null,
    engineSummary: engineSummary() as unknown as Record<string, unknown>,
    phases: initialPhases(),
  });
  secrets.set(id, {
    systemDescription: input.systemDescription,
    locale: input.locale,
    repoUrl: input.repoUrl || undefined,
    token,
    skills: input.skills || [],
  });
  sweepIfDue();
  return id;
}

/** Reconstrói o shape de Job (consumido por results/report) a partir da linha. */
export async function getAnalysis(id: string): Promise<Job | undefined> {
  const row = await analysesRepo.getById(id);
  if (!row) return undefined;
  const phases = (row.phases as Job["phases"]) ?? initialPhases();
  const skillNames = phases.skills?.result?.map((s) => s.skillName) ?? [];
  const input: JobInputPublic = {
    projectName: row.projectName,
    systemDescription: row.systemDescription,
    repoUrl: row.repoUrl ?? undefined,
    hasToken: false,
    skillNames,
  };
  return {
    id: row.id,
    createdAt: row.createdAt.getTime(),
    input,
    progress: row.progress,
    phases,
  };
}

/** Retorna o dono da análise (para checagem de acesso na rota). */
export async function getAnalysisOwner(id: string): Promise<string | undefined> {
  const row = await analysesRepo.getById(id);
  return row?.userId;
}

/**
 * Progresso = fases efetivamente CONCLUÍDAS. Gravar 100 no fim do job mesmo
 * com fase em erro fazia a lista mostrar "100%" ao lado de "erro" — duas
 * informações que se contradizem. Ver AUDITORIA.md#BUG-21.
 */
export function computeProgress(phases: Job["phases"]): number {
  const all = Object.values(phases) as PhaseState[];
  if (!all.length) return 0;
  const done = all.filter((p) => p.status === "done").length;
  return Math.round((done / all.length) * 100);
}

// `prsCount` fica de fora de propósito: quem o mantém é o repositório de PRs,
// que incrementa a cada PR aberto. Recalculá-lo aqui zeraria o contador, já
// que `phases.refactor.prs` está sempre vazio. Ver AUDITORIA.md#BUG-08.
function computeMetrics(
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

async function runPhase<T>(
  phases: Job["phases"],
  id: string,
  key: PhaseKey,
  fn: () => Promise<T>
): Promise<void> {
  const ph = phases[key] as PhaseState<T>;
  ph.status = "running";
  ph.startedAt = Date.now();
  // Persiste o "running" para o polling refletir o andamento em tempo real.
  await analysesRepo
    .patchAnalysis(id, { phases, status: "running" })
    .catch(() => {});
  try {
    // `timed` registra duração e `ok` no mesmo evento — é o que dá métrica de
    // tempo por fase e taxa de erro sem parsear texto (AUDITORIA.md#ARQ-07).
    ph.result = await timed("phase", { jobId: id, phase: key }, fn);
    ph.status = "done";
  } catch (e) {
    ph.status = "error";
    // Redigido: este texto é PERSISTIDO no JSONB e exibido na tela; erros de
    // ferramenta externa podem carregar credenciais (AUDITORIA.md#SEC-01).
    ph.error = redactError(e) || "Falha na etapa.";
  } finally {
    ph.finishedAt = Date.now();
  }
}

/**
 * Marca como erro toda fase que não chegou ao fim, com um motivo legível.
 * Sem isto, a análise fica `status: "error"` e a tela não diz o porquê.
 */
export function failUnfinishedPhases(
  phases: Job["phases"],
  motivo: string
): Job["phases"] {
  for (const p of Object.values(phases) as PhaseState[]) {
    if (p.status === "done" || p.status === "error") continue;
    p.status = "error";
    p.error = motivo;
    p.finishedAt = Date.now();
  }
  return phases;
}

const ORPHAN_MSG =
  "A análise foi interrompida antes de começar (o servidor reiniciou). Rode de novo — nada foi perdido no repositório.";
const STALE_MSG =
  "A análise não deu sinal de vida por tempo demais e foi encerrada (provável reinício do servidor durante o processamento).";

/** Sem sinal por este tempo, a análise é dada como perdida. */
const STALE_AFTER_MS = Number(process.env.ANALYSIS_STALE_MS || 20 * 60_000);

/**
 * Encerra análises abandonadas. Os segredos do job vivem num Map em memória e
 * o disparo é fire-and-forget: um restart do processo (todo deploy no Render é
 * um) deixa a linha em `running` para sempre, sem timeout e sem mensagem.
 * Ver AUDITORIA.md#BUG-11 — a solução definitiva é a fila do #ARQ-04.
 */
export async function expireStaleAnalyses(): Promise<number> {
  // O MESMO corte na leitura e na escrita: se o job voltar a escrever entre as
  // duas, o UPDATE condicional não casa e nada é atropelado (#BUG-20).
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await analysesRepo
    .listStale(STALE_AFTER_MS, cutoff)
    .catch(() => []);
  let n = 0;
  for (const row of stale) {
    const phases = failUnfinishedPhases(
      (row.phases as Job["phases"]) ?? initialPhases(),
      STALE_MSG
    );
    await analysesRepo
      .patchIfUntouchedSince(row.id, cutoff, {
        phases,
        status: "error",
        progress: computeProgress(phases),
        finishedAt: new Date(),
      })
      .then((gravou) => {
        if (gravou) n++;
      })
      .catch(() => {});
  }
  if (n > 0) log.warn("jobs.expired", { count: n });
  return n;
}

// A varredura roda de carona na criação de análise, no máximo uma vez por
// minuto: sem fila e sem cron, é o gancho que existe e não custa nada.
let lastSweep = 0;
function sweepIfDue(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  void expireStaleAnalyses().catch(() => {});
}

export async function runJob(id: string): Promise<void> {
  const raw = secrets.get(id);
  // Segredos ausentes = o processo que criou a análise morreu antes de rodar.
  // Retornar em silêncio deixava a linha `pending` para sempre (#BUG-11).
  if (!raw) {
    const phases = failUnfinishedPhases(initialPhases(), ORPHAN_MSG);
    await analysesRepo
      .patchAnalysis(id, {
        phases,
        status: "error",
        progress: 0,
        finishedAt: new Date(),
      })
      .catch(() => {});
    log.warn("job.orphan", { jobId: id });
    return;
  }
  const phases = initialPhases();
  audit("analyze.start", { jobId: id });

  // O progresso é derivado das fases concluídas, nunca cravado à mão: era
  // assim que "100%" convivia com "erro" na lista (#BUG-21).
  const persist = () =>
    analysesRepo
      .patchAnalysis(id, { phases, progress: computeProgress(phases) })
      .catch(() => {});

  try {
    await analysesRepo
      .patchAnalysis(id, { status: "running", startedAt: new Date() })
      .catch(() => {});

    await runPhase(phases, id, "plan", () =>
      generateThreatModel(raw.systemDescription, raw.locale)
    );
    await persist();

    await runPhase(phases, id, "skills", () => validateSkills(raw.skills || []));
    await persist();

    await runPhase(phases, id, "software", () =>
      runScan(raw.repoUrl, raw.token, {
        systemDescription: raw.systemDescription,
        requirements: phases.plan.result?.requirements,
        locale: raw.locale,
      })
    );

    // Cada achado vira uma linha com estado próprio, herdando o que já foi
    // resolvido em análises anteriores do mesmo repositório. Falhar aqui não
    // pode derrubar a análise — o JSONB `phases` continua sendo a fonte dos
    // dados; a tabela é o que dá memória. Ver AUDITORIA.md#FEAT-01.
    const scanResult = phases.software.result;
    if (scanResult) {
      const userId = await analysesRepo
        .getById(id)
        .then((r) => r?.userId)
        .catch(() => undefined);
      if (userId) {
        await findingsRepo
          .persistScanFindings(id, userId, raw.repoUrl || null, scanResult)
          .then((herdados) => {
            if (herdados > 0) {
              log.info("findings.inherited", { jobId: id, count: herdados });
            }
          })
          .catch((e) => log.error("findings.persist.failed", { jobId: id, error: e }));
      }
    }

    await persist();

    // A Fase 4 não gera mais correção automática. Ela gerava UMA — só do achado
    // mais grave — e pelo pior caminho disponível: sem `repoUrl`, ou seja, sem
    // o arquivo inteiro e sem o engine de agente. O usuário comparava com a
    // correção sob demanda (que usa os dois) e via duas qualidades diferentes
    // para o mesmo produto. Somado a isso, com FIX_ENGINE=agent — o padrão —
    // toda análise custava um clone do repositório e até 4,5 min de agente que
    // ninguém pediu, contra o princípio já adotado em UX-05 e o cache do
    // FEAT-02. Correção agora é sempre sob demanda. Ver AUDITORIA.md#BUG-16.
    await runPhase(phases, id, "refactor", async () => ({ fixes: [], prs: [] }));

    const anyError = (Object.values(phases) as PhaseState[]).some(
      (p) => p.status === "error"
    );
    await analysesRepo.patchAnalysis(id, {
      phases,
      progress: computeProgress(phases),
      status: anyError ? "error" : "done",
      finishedAt: new Date(),
      metrics: computeMetrics(phases),
    });
    audit("analyze.done", { jobId: id });
  } catch (e) {
    // Falha inesperada fora das fases: marca a análise como erro — e as fases
    // que ficaram no meio do caminho recebem o motivo, senão a tela mostra
    // "erro" sem dizer onde (#BUG-11).
    failUnfinishedPhases(phases, redactError(e) || "Falha inesperada na análise.");
    await analysesRepo
      .patchAnalysis(id, {
        phases,
        progress: computeProgress(phases),
        status: "error",
        finishedAt: new Date(),
        metrics: computeMetrics(phases),
      })
      .catch(() => {});
    log.error("job.failed", { jobId: id, error: e });
  } finally {
    // Token e skills só vivem em memória durante o job.
    secrets.delete(id);
  }
}

/** Dispara a orquestração sem bloquear a resposta HTTP. */
export function startJob(id: string): void {
  void runJob(id).catch((e) => {
    log.error("job.failed", { jobId: id, error: e });
  });
}
