// ============================================================
// Ciclo de vida da análise no painel web.
//
// O que este arquivo NÃO faz mais: orquestrar. As quatro fases em sequência
// saíram daqui — quem decide o que roda, em que ordem e com quanto paralelismo
// é `@starguard/core/orchestrator`, o mesmo que o terminal e a extensão do VS
// Code usam. O que sobrou é o que só existe no painel: criar a linha no banco,
// guardar o plaintext só durante o uso, selar o contexto para a fila, disparar
// sem bloquear a resposta HTTP e recolher análises abandonadas.
//
// Segredos (token do GitHub + conteúdo das skills) nunca são persistidos em
// claro: ficam num Map durante a requisição e num envelope AES-256-GCM dentro
// do job até o estado terminal, quando o envelope é removido.
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
import { decryptToken, encryptToken, type EncryptedToken } from "@/lib/crypto";

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
 * Recupera o contexto autenticado que viajou cifrado na fila.
 *
 * AES-GCM garante autenticidade; a validação abaixo garante também o shape,
 * para uma linha antiga/corrompida nunca virar entrada arbitrária no motor.
 */
function abrirTransient(valor: unknown): Transient | undefined {
  if (!valor || typeof valor !== "object") return undefined;
  const enc = valor as Partial<EncryptedToken>;
  if (
    typeof enc.ciphertext !== "string" ||
    typeof enc.iv !== "string" ||
    typeof enc.authTag !== "string"
  ) {
    return undefined;
  }
  try {
    const raw = JSON.parse(decryptToken(enc as EncryptedToken)) as Partial<Transient>;
    if (typeof raw.systemDescription !== "string" || !Array.isArray(raw.selected)) {
      return undefined;
    }
    const validos = new Set<string>(ANALYZER_IDS);
    const selected = raw.selected.filter((id): id is AnalyzerId => validos.has(id));
    const skills = Array.isArray(raw.skills)
      ? raw.skills.filter(
          (s): s is { name: string; content: string } =>
            !!s && typeof s.name === "string" && typeof s.content === "string"
        )
      : [];
    return {
      systemDescription: raw.systemDescription,
      locale: raw.locale ? normalizeLocale(raw.locale) : undefined,
      repoUrl: typeof raw.repoUrl === "string" ? raw.repoUrl : undefined,
      token: typeof raw.token === "string" ? raw.token : undefined,
      skills,
      selected,
    };
  } catch {
    return undefined;
  }
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
  return jobFromRow(row);
}

function jobFromRow(row: NonNullable<Awaited<ReturnType<typeof analysesRepo.getById>>>): Job {
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

/** Job e dono na mesma leitura — `/api/status` é consultado repetidamente. */
export async function getAnalysisWithOwner(
  id: string
): Promise<{ job: Job; owner: string } | undefined> {
  const row = await analysesRepo.getById(id);
  if (!row) return undefined;
  return { job: jobFromRow(row), owner: row.userId };
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
 * Encerra análises abandonadas de gerações antigas ou falhas irrecuperáveis.
 * A fila e o contexto cifrado retomam jobs atuais; esta varredura continua
 * sendo a última defesa para linhas que nunca mais receberam heartbeat.
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

export async function runJob(id: string, transientCifrado?: unknown): Promise<void> {
  // Idempotência: se o processo morreu depois de finalizar a análise mas antes
  // de confirmar a fila, a retomada não pode cobrar IA e escanear tudo de novo.
  const row = await analysesRepo.getById(id).catch(() => undefined);
  if (!row || row.finishedAt) return;

  const raw = secrets.get(id) ?? abrirTransient(transientCifrado);
  // Segredos ausentes = o processo que criou a análise morreu antes de rodar.
  // Retornar em silêncio deixava a linha `pending` para sempre (#BUG-11).
  if (!raw) {
    const dono = row.userId;
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
  const userId = row.userId;
  audit("analyze.start", { jobId: id });

  const sink = postgresSink({
    analysisId: id,
    userId: userId ?? "",
    locale,
    repoUrl: raw.repoUrl,
    selected: raw.selected,
  });

  // Um SAST/SCA pode passar vários minutos dentro do processo nativo sem
  // emitir evento. Sem heartbeat, `expireStaleAnalyses` confundia trabalho
  // lento com processo morto e encerrava uma análise ainda viva.
  const heartbeat = setInterval(() => {
    void analysesRepo.touchAnalysis(id).catch(() => {});
  }, Number(process.env.ANALYSIS_HEARTBEAT_MS) || 30_000);
  heartbeat.unref();

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
    clearInterval(heartbeat);
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
 * O contexto transitório vai cifrado com AES-256-GCM. Assim outro processo
 * pode retomar o job sem que token ou conteúdo de skill apareçam em claro no
 * banco; `concluir`/`falhar` removem o envelope no estado terminal.
 */
export async function startJob(id: string): Promise<void> {
  const { enqueue } = await import("@/lib/queue");
  const raw = secrets.get(id);
  // Diferentemente do código-fonte clonado, este contexto precisa sobreviver
  // ao restart para a fila persistente ser realmente persistente. Viaja no
  // JSONB apenas como AES-256-GCM e é removido assim que o job termina/morre.
  let transient: EncryptedToken | undefined;
  try {
    transient = raw ? encryptToken(JSON.stringify(raw)) : undefined;
  } catch (e) {
    // Configuração criptográfica quebrada não pode deixar a linha `pending`
    // eternamente. Executa no processo atual (menos resiliente) e registra a
    // causa; o plaintext continua sem ser persistido.
    log.error("job.seal.failed", { jobId: id, error: e });
    void runJob(id).catch((err) => log.error("job.failed", { jobId: id, error: err }));
    return;
  }
  await enqueue({
    kind: "analysis",
    // Só a REFERÊNCIA: o payload é gravado em claro e sobrevive ao job.
    payload: { analysisId: id, ...(transient ? { transient } : {}) },
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
