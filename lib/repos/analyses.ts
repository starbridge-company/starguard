// ============================================================
// Repositório de análises (job das 4 fases, persistido). NODE-ONLY.
// As colunas de métrica são desnormalizadas para permitir listar/ordenar/
// agregar sem parsear o JSONB de phases.
// ============================================================
import "server-only";
import { and, desc, eq, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { analyses, users, type NewAnalysis } from "@/db/schema";
import { paged, type PageParams, type Paged } from "@/lib/pagination";
import type { AnalyzerId, Job } from "@/types";

export type AnalysisStatus = "pending" | "running" | "done" | "error";

export interface AnalysisMetrics {
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  sastCount: number;
  scaCount: number;
  reviewCount: number;
  fixesCount: number;
  prsCount: number;
  totalFindings: number;
}

export interface AnalysisPatch {
  phases?: Job["phases"];
  progress?: number;
  status?: AnalysisStatus;
  startedAt?: Date;
  finishedAt?: Date;
  metrics?: Partial<AnalysisMetrics>;
}

export interface AnalysisListItem {
  id: string;
  projectName: string;
  repoUrl: string | null;
  status: AnalysisStatus;
  progress: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalFindings: number;
  prsCount: number;
  createdAt: Date;
  finishedAt: Date | null;
}

const LIST_COLS = {
  id: analyses.id,
  projectName: analyses.projectName,
  repoUrl: analyses.repoUrl,
  status: analyses.status,
  progress: analyses.progress,
  criticalCount: analyses.criticalCount,
  highCount: analyses.highCount,
  mediumCount: analyses.mediumCount,
  lowCount: analyses.lowCount,
  totalFindings: analyses.totalFindings,
  prsCount: analyses.prsCount,
  createdAt: analyses.createdAt,
  finishedAt: analyses.finishedAt,
};

export async function createAnalysis(input: {
  userId: string;
  projectName: string;
  systemDescription: string;
  repoUrl?: string | null;
  /** Analisadores escolhidos. Ausente = todos (é como as linhas antigas são lidas). */
  selected?: AnalyzerId[];
  engineSummary?: Record<string, unknown>;
  phases: Job["phases"];
}): Promise<string> {
  const values: NewAnalysis = {
    userId: input.userId,
    projectName: input.projectName,
    systemDescription: input.systemDescription,
    repoUrl: input.repoUrl ?? null,
    status: "pending",
    progress: 0,
    selected: input.selected,
    engineSummary: input.engineSummary,
    phases: input.phases,
  };
  const [row] = await db.insert(analyses).values(values).returning({ id: analyses.id });
  return row!.id;
}

function patchToSet(patch: AnalysisPatch): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.phases !== undefined) set.phases = patch.phases;
  if (patch.progress !== undefined) set.progress = patch.progress;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
  if (patch.finishedAt !== undefined) set.finishedAt = patch.finishedAt;
  if (patch.metrics) Object.assign(set, patch.metrics);
  return set;
}

/**
 * Atualiza colunas de progresso/fase/métrica de uma análise em andamento.
 *
 * Grava o JSONB `phases` inteiro. Isso seria condição de corrida se houvesse
 * dois escritores — e é o que o AUDITORIA.md#BUG-20 previa para quando o
 * estado por achado começasse a ser gravado. Não aconteceu: o FEAT-01 levou os
 * achados para a tabela `findings`, que é a alternativa que o próprio item
 * indicava. Hoje quem escreve `phases` é só o `runJob` da própria análise —
 * mais o encerramento de análise abandonada, que usa `patchIfUntouchedSince`
 * justamente para não atropelar um job vivo.
 */
export async function patchAnalysis(id: string, patch: AnalysisPatch): Promise<void> {
  await db.update(analyses).set(patchToSet(patch)).where(eq(analyses.id, id));
}

/** Atualiza somente o batimento de um job longo, sem regravar o JSONB pesado. */
export async function touchAnalysis(id: string): Promise<void> {
  await db.update(analyses).set({ updatedAt: new Date() }).where(eq(analyses.id, id));
}

/**
 * Igual ao `patchAnalysis`, mas só grava se a linha continuar sem sinal de
 * vida desde `since`. Se o job voltou a escrever entre a leitura e a escrita,
 * o UPDATE não casa e nada é sobrescrito. Ver AUDITORIA.md#BUG-11 e #BUG-20.
 */
export async function patchIfUntouchedSince(
  id: string,
  since: Date,
  patch: AnalysisPatch
): Promise<boolean> {
  const rows = await db
    .update(analyses)
    .set(patchToSet(patch))
    .where(and(eq(analyses.id, id), lt(analyses.updatedAt, since)))
    .returning({ id: analyses.id });
  return rows.length > 0;
}

/**
 * Análises presas em `pending`/`running` sem sinal de vida há mais de
 * `olderThanMs`. Devolve id + phases para que o chamador marque as fases
 * inacabadas com um motivo legível. Ver AUDITORIA.md#BUG-11.
 *
 * O corte é por `updatedAt`: um job vivo escreve a cada fase, então uma linha
 * parada é exatamente a que perdeu o processo (deploy, restart, crash).
 */
export async function listStale(olderThanMs: number, cutoff = new Date(Date.now() - olderThanMs)) {
  // `userId` vem junto para que a mensagem de encerramento seja escrita no
  // idioma do dono — ela fica GRAVADA no JSONB e é lida assim para sempre.
  return db
    .select({
      id: analyses.id,
      userId: analyses.userId,
      phases: analyses.phases,
      progress: analyses.progress,
    })
    .from(analyses)
    .where(
      and(
        isNull(analyses.deletedAt),
        isNull(analyses.finishedAt),
        or(eq(analyses.status, "pending"), eq(analyses.status, "running")),
        lt(analyses.updatedAt, cutoff)
      )
    )
    .limit(100);
}

/**
 * Soft delete. Devolve `false` se a análise já estava excluída (ou não existe)
 * — assim a rota não responde 200 para algo que não aconteceu.
 * Ver AUDITORIA.md#BUG-22.
 */
export async function softDelete(id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(analyses)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(analyses.id, id), isNull(analyses.deletedAt)))
    .returning({ id: analyses.id });
  return rows.length > 0;
}

export async function getById(id: string) {
  const rows = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), isNull(analyses.deletedAt)))
    .limit(1);
  return rows[0];
}

function textFilter(q?: string) {
  if (!q || !q.trim()) return undefined;
  const like = `%${q.trim()}%`;
  return or(ilike(analyses.projectName, like), ilike(analyses.repoUrl, like));
}

// Filtros compartilhados entre a lista própria e a global.
export interface AnalysisFilters {
  q?: string;
  status?: AnalysisStatus;
  from?: Date;
  to?: Date; // exclusivo (fim do dia já somado pelo chamador)
}

function commonFilters(opts: AnalysisFilters) {
  return [
    opts.status ? eq(analyses.status, opts.status) : undefined,
    opts.from ? gte(analyses.createdAt, opts.from) : undefined,
    opts.to ? lt(analyses.createdAt, opts.to) : undefined,
    textFilter(opts.q),
  ];
}

/** Lista as análises de UM usuário (histórico próprio). */
export async function listForUser(
  userId: string,
  p: PageParams,
  opts: AnalysisFilters = {}
): Promise<Paged<AnalysisListItem>> {
  const where = and(
    eq(analyses.userId, userId),
    isNull(analyses.deletedAt),
    ...commonFilters(opts)
  );
  const items = await db
    .select(LIST_COLS)
    .from(analyses)
    .where(where)
    .orderBy(desc(analyses.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(analyses)
    .where(where);
  return paged(items as AnalysisListItem[], c ?? 0, p);
}

export interface AdminAnalysisItem extends AnalysisListItem {
  userId: string;
  userEmail: string;
  userName: string;
}

/** Lista TODAS as análises (superadmin), com o dono. */
export async function listAll(
  p: PageParams,
  opts: AnalysisFilters & { userId?: string } = {}
): Promise<Paged<AdminAnalysisItem>> {
  const where = and(
    isNull(analyses.deletedAt),
    opts.userId ? eq(analyses.userId, opts.userId) : undefined,
    ...commonFilters(opts)
  );
  const items = await db
    .select({
      ...LIST_COLS,
      userId: analyses.userId,
      userEmail: users.email,
      userName: users.name,
    })
    .from(analyses)
    .innerJoin(users, eq(users.id, analyses.userId))
    .where(where)
    .orderBy(desc(analyses.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(analyses)
    .where(where);
  return paged(items as AdminAnalysisItem[], c ?? 0, p);
}

export interface GlobalMetrics {
  totalUsers: number;
  totalAnalyses: number;
  running: number;
  done: number;
  error: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  totalFindings: number;
  totalPRs: number;
  last7dAnalyses: number;
}

/** KPIs globais para o painel do superadmin (uma passada agregada). */
export async function globalMetrics(): Promise<GlobalMetrics> {
  const [row] = (
    await db.execute(sql`
      select
        (select count(*)::int from starguard.users where deleted_at is null)             as "totalUsers",
        count(*)::int                                                                    as "totalAnalyses",
        coalesce(sum((status = 'running')::int), 0)::int                                 as "running",
        coalesce(sum((status = 'done')::int), 0)::int                                    as "done",
        coalesce(sum((status = 'error')::int), 0)::int                                   as "error",
        coalesce(sum(critical_count), 0)::int                                            as "critical",
        coalesce(sum(high_count), 0)::int                                                as "high",
        coalesce(sum(medium_count), 0)::int                                              as "medium",
        coalesce(sum(low_count), 0)::int                                                 as "low",
        coalesce(sum(total_findings), 0)::int                                            as "totalFindings",
        (select count(*)::int from starguard.pull_requests)                              as "totalPRs",
        coalesce(sum((created_at > now() - interval '7 days')::int), 0)::int             as "last7dAnalyses"
      from starguard.analyses
      where deleted_at is null
    `)
  ).rows as unknown as GlobalMetrics[];
  return row;
}
