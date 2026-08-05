// ============================================================
// A fila — AUDITORIA.md#ARQ-04.
//
// Uma fila no próprio Postgres. A peça que a torna correta é
// `FOR UPDATE SKIP LOCKED`: várias instâncias podem chamar `pegarProximo` ao
// mesmo tempo e cada uma leva um job diferente, sem coordenação externa e sem
// que ninguém espere pela outra. É o padrão que substitui um Redis inteiro
// quando o volume é o deste produto.
//
// **Nenhum segredo entra no `payload`.** Ele é gravado em claro e fica no
// banco depois do job terminar. Token do GitHub e conteúdo de skill continuam
// no mapa em memória (`lib/jobs.ts`) ou vêm do installation token do App, que
// é gerado na hora e vale uma hora. O que vai no payload é referência: qual
// análise, qual repositório, qual PR.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/db/schema";
import { log } from "@starguard/core/logger";

export type JobKind = "analysis" | "webhook";

export interface EnqueueInput {
  kind: JobKind;
  payload: Record<string, unknown>;
  userId?: string;
  /** Mesma chave = mesmo trabalho; o segundo é descartado. */
  dedupeKey?: string;
  maxAttempts?: number;
  /** Adiar a primeira execução (agendamento simples). */
  delayMs?: number;
}

/**
 * Enfileira. Devolve o id, ou `null` quando foi descartado por duplicidade.
 *
 * A deduplicação é feita por consulta e não por índice único porque a regra é
 * "não duplicar entre os NÃO TERMINADOS": um job igual que já rodou semana
 * passada deve poder rodar de novo. Um índice único simples proibiria isso
 * para sempre.
 */
export async function enqueue(input: EnqueueInput): Promise<string | null> {
  if (input.dedupeKey) {
    const [existente] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.dedupeKey, input.dedupeKey),
          or(eq(jobs.status, "queued"), eq(jobs.status, "running"))
        )
      )
      .limit(1);
    if (existente) {
      log.info("queue.deduped", { jobId: existente.id });
      return null;
    }
  }

  const [row] = await db
    .insert(jobs)
    .values({
      kind: input.kind,
      payload: input.payload,
      userId: input.userId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      runAfter: new Date(Date.now() + (input.delayMs ?? 0)),
    })
    .returning({ id: jobs.id });

  return row!.id;
}

export interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  userId: string | null;
  attempts: number;
  maxAttempts: number;
}

/** Depois disto sem terminar, o job é dado como abandonado e volta à fila. */
const LOCK_STALE_MS = Number(process.env.QUEUE_LOCK_STALE_MS || 15 * 60_000);

/**
 * Pega o próximo job e o marca como `running`, atomicamente.
 *
 * `FOR UPDATE SKIP LOCKED` é o coração: sem ele, duas instâncias leriam a
 * mesma linha e a análise rodaria duas vezes — gastando IA duas vezes. Com
 * ele, a segunda simplesmente pula para o próximo.
 *
 * A cláusula do `locked_at` velho é o que faz um worker morto (deploy no meio
 * do job, processo derrubado) não travar a fila para sempre. É a mesma doença
 * do BUG-11, resolvida aqui na origem.
 */
export async function pegarProximo(workerId: string): Promise<JobRow | null> {
  const linhas = await db.execute<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    user_id: string | null;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE starguard.jobs SET
      status = 'running',
      locked_by = ${workerId},
      locked_at = now(),
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM starguard.jobs
      WHERE (status = 'queued' AND run_after <= now())
         OR (status = 'running' AND locked_at < now() - ${sql.raw(`interval '${Math.floor(LOCK_STALE_MS / 1000)} seconds'`)})
      ORDER BY run_after
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, payload, user_id, attempts, max_attempts
  `);

  const rows = (linhas as unknown as { rows?: unknown[] }).rows ?? linhas;
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;

  return {
    id: r.id as string,
    kind: r.kind as string,
    payload: r.payload as Record<string, unknown>,
    userId: (r.user_id as string) ?? null,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
  };
}

export async function concluir(jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "done", finishedAt: new Date(), lockedBy: null, lockedAt: null })
    .where(eq(jobs.id, jobId));
}

/**
 * Marca falha. Volta para a fila com backoff, ou morre depois das tentativas.
 *
 * `dead` e não `error`: um job que esgotou as tentativas não deve ser
 * reprocessado sozinho, mas também não pode sumir — alguém precisa olhar. Os
 * dois estados existem para essa distinção ser consultável.
 */
export async function falhar(job: JobRow, erro: string): Promise<void> {
  const acabou = job.attempts >= job.maxAttempts;
  // Backoff exponencial: 1 min, 2 min, 4 min. Repetir na hora contra um
  // serviço fora do ar só gasta tentativa.
  const espera = Math.min(2 ** (job.attempts - 1), 30) * 60_000;

  await db
    .update(jobs)
    .set({
      status: acabou ? "dead" : "queued",
      lastError: erro.slice(0, 2000),
      lockedBy: null,
      lockedAt: null,
      runAfter: new Date(Date.now() + espera),
      finishedAt: acabou ? new Date() : null,
    })
    .where(eq(jobs.id, job.id));

  if (acabou) log.error("queue.dead", { jobId: job.id, error: erro });
}

/** Devolve jobs presos por worker morto. Usado pelo `/api/health`. */
export async function contarPresos(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "running"),
        isNotNull(jobs.lockedAt),
        lt(jobs.lockedAt, new Date(Date.now() - LOCK_STALE_MS))
      )
    );
  return Number(r?.n ?? 0);
}

export interface EstatisticaFila {
  queued: number;
  running: number;
  dead: number;
}

export async function estatisticas(): Promise<EstatisticaFila> {
  const linhas = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  const mapa = Object.fromEntries(linhas.map((l) => [l.status, Number(l.n)]));
  return {
    queued: mapa.queued ?? 0,
    running: mapa.running ?? 0,
    dead: mapa.dead ?? 0,
  };
}
