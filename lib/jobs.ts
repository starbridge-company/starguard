// ============================================================
// Ciclo de vida da análise no painel web.
//
// O que este arquivo NÃO faz mais: orquestrar. As quatro fases em sequência
// saíram daqui — quem decide o que roda, em que ordem e com quanto paralelismo
// é `@starguard/core/orchestrator`, o mesmo que o terminal e a extensão do VS
// Code usam. O que sobrou é o que só existe no painel: criar a linha no banco,
// guardar os segredos em memória enquanto o job vive, disparar sem bloquear a
// resposta HTTP e recolher análises abandonadas.
//
// Segredos (token do GitHub decifrado + conteúdo das skills) vivem APENAS num
// mapa em memória durante o job e são apagados no fim — nunca são persistidos.
// ============================================================
import "server-only";
import { engineSummary } from "@/lib/config";
import { analyze, plan } from "@starguard/core";
import { audit } from "@/lib/auth";
import { redactError } from "@starguard/core/redact";
import { log } from "@starguard/core/logger";
import * as analysesRepo from "@/lib/repos/analyses";
import * as tokensRepo from "@/lib/repos/tokens";
import { computeMetrics, computeProgress, initialPhases, postgresSink } from "@/lib/sinks/postgres";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/translate";
import { ANALYZER_IDS, type AnalyzerId } from "@/types";
import type { Job, JobInput, JobInputPublic, PhaseState } from "@/types";

// Segredos transitórios (nunca vão ao BD).
interface Transient {
  systemDescription: string;
  /** Idioma do usuário no momento da criação — o job roda destacado da
   *  requisição, então precisa carregar essa informação junto. */
  locale?: Locale;
  repoUrl?: string;
  token?: string;
  skills: { name: string; content: string }[];
  /** Analisadores escolhidos na Tela 1. */
  selected: AnalyzerId[];
}

const g = globalThis as unknown as { __sg_secrets?: Map<string, Transient> };
g.__sg_secrets ||= new Map();
const secrets = g.__sg_secrets!;

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
  /** Vazio ou ausente = todos os analisadores (é o comportamento de sempre). */
  select?: AnalyzerId[];
}

/** Cria a análise no BD (status pending) e guarda os segredos em memória. */
export async function createAnalysis(
  userId: string,
  input: CreateAnalysisInput
): Promise<string> {
  const token = await resolveToken(userId, input);
  const selected =
    input.select?.length ? input.select : ([...ANALYZER_IDS] as AnalyzerId[]);
  const id = await analysesRepo.createAnalysis({
    userId,
    projectName: input.projectName,
    systemDescription: input.systemDescription,
    repoUrl: input.repoUrl || null,
    selected,
    engineSummary: engineSummary() as unknown as Record<string, unknown>,
    phases: initialPhases(),
  });
  secrets.set(id, {
    systemDescription: input.systemDescription,
    locale: input.locale,
    repoUrl: input.repoUrl || undefined,
    token,
    skills: input.skills || [],
    selected,
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
    // Linha antiga não tem a coluna preenchida: ela rodou as quatro fases, que
    // é o mesmo que ter escolhido todos os analisadores. Ler `null` como
    // "todos" evita migrar dado histórico só para registrar o óbvio.
    selected: (row.selected as AnalyzerId[] | null) ?? [...ANALYZER_IDS],
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

export { computeProgress, computeMetrics };

/**
 * Marca como erro toda fase que não chegou ao fim, com um motivo legível.
 * Sem isto, a análise fica `status: "error"` e a tela não diz o porquê.
 *
 * Fase `skipped` é pulada: não terminar algo que ninguém pediu não é falha.
 */
export function failUnfinishedPhases(
  phases: Job["phases"],
  motivo: string
): Job["phases"] {
  for (const p of Object.values(phases) as PhaseState[]) {
    if (p.status === "done" || p.status === "error" || p.status === "skipped") {
      continue;
    }
    p.status = "error";
    p.error = motivo;
    p.finishedAt = Date.now();
  }
  return phases;
}

/**
 * Idioma do dono da análise.
 *
 * As mensagens de encerramento (órfã/abandonada) são gravadas no JSONB e lidas
 * depois direto do banco — não passam mais pelo `t()` de ninguém. Quando o job
 * já morreu, o `locale` que veio na criação não existe mais em memória, então a
 * única fonte que resta é a preferência salva na conta. Falha aqui não pode
 * derrubar a varredura: cai no padrão.
 */
async function ownerLocale(userId: string | null | undefined): Promise<Locale> {
  if (!userId) return DEFAULT_LOCALE;
  try {
    const { findById } = await import("@/lib/repos/users");
    const user = await findById(userId);
    return normalizeLocale(user?.locale);
  } catch {
    return DEFAULT_LOCALE;
  }
}

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
      translate(await ownerLocale(row.userId), "job.stale")
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
    const dono = await analysesRepo
      .getById(id)
      .then((r) => r?.userId)
      .catch(() => undefined);
    const phases = failUnfinishedPhases(
      initialPhases(),
      translate(await ownerLocale(dono), "job.orphan")
    );
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

  const locale = raw.locale || DEFAULT_LOCALE;
  const userId = await analysesRepo
    .getById(id)
    .then((r) => r?.userId)
    .catch(() => undefined);
  audit("analyze.start", { jobId: id });

  const sink = postgresSink({
    analysisId: id,
    userId: userId ?? "",
    locale,
    repoUrl: raw.repoUrl,
    selected: raw.selected,
  });

  try {
    await analyze({
      select: raw.selected,
      // Sem repositório a origem é `none`: os analisadores que precisam de
      // código ficam de fora COM motivo, em vez de rodar sobre o vazio.
      source: raw.repoUrl
        ? { type: "git", url: raw.repoUrl, token: raw.token }
        : { type: "none" },
      locale,
      systemDescription: raw.systemDescription,
      skills: raw.skills,
      sinks: [sink],
    });
    audit("analyze.done", { jobId: id });
  } catch (e) {
    // Falha FORA dos analisadores (clone impossível, banco fora do ar): o
    // orquestrador isola a falha de cada analisador, então chegar aqui
    // significa que a execução inteira caiu. As fases que ficaram no meio do
    // caminho recebem o motivo, senão a tela mostra "erro" sem dizer onde.
    const phases = failUnfinishedPhases(
      sink.phases,
      redactError(e) || translate(locale, "job.unexpected")
    );
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

/**
 * Enfileira a análise. A rota responde sem esperar.
 *
 * Antes era `fire-and-forget`: a promessa era disparada e esquecida, e um
 * restart do processo (todo deploy é um) deixava a linha em `running` para
 * sempre — o BUG-11. Agora o trabalho vive no banco e alguém volta a pegá-lo.
 *
 * **O que a fila NÃO resolve**, e continua aberto no ARQ-06: os SEGREDOS do
 * job (token do GitHub decifrado, conteúdo das skills) seguem num mapa em
 * memória. Se o job for retomado por outro processo, eles não estarão lá e a
 * análise termina como órfã, com a mensagem explicando. Resolver isso exige
 * decidir onde guardar segredo transitório — e guardá-lo em lugar nenhum foi
 * uma escolha deliberada de segurança, não um esquecimento.
 */
export async function startJob(id: string): Promise<void> {
  const { enqueue } = await import("@/lib/queue");
  await enqueue({
    kind: "analysis",
    // Só a REFERÊNCIA: o payload é gravado em claro e sobrevive ao job.
    payload: { analysisId: id },
    // Mesma análise enfileirada duas vezes é engano de quem chamou.
    dedupeKey: `analysis:${id}`,
  }).catch((e) => {
    log.error("job.enqueue.failed", { jobId: id, error: e });
    // A fila fora do ar não pode impedir a análise de rodar: cai no caminho
    // antigo, que é pior (não sobrevive a restart) mas melhor que nada.
    void runJob(id).catch((err) => log.error("job.failed", { jobId: id, error: err }));
  });
}

/**
 * O que roda e o que não roda, ANTES de criar a análise.
 *
 * É o que a Tela 1 consulta para desenhar o seletor: cada analisador com a sua
 * disponibilidade e, quando indisponível, o motivo. Vale a pena ser a mesma
 * função que o job usa — se divergissem, a tela ofereceria o que o job recusa.
 */
export async function previewPlan(input: {
  select?: AnalyzerId[];
  repoUrl?: string;
  systemDescription?: string;
  skills?: { name: string; content: string }[];
  locale?: Locale;
}) {
  return plan({
    select: input.select,
    source: input.repoUrl
      ? { type: "git", url: input.repoUrl }
      : { type: "none" },
    locale: input.locale,
    systemDescription: input.systemDescription,
    skills: input.skills,
  });
}
