// ============================================================
// Repositório de auditoria. NODE-ONLY. Escrita é best-effort (nunca lança
// para não derrubar o fluxo principal). Leitura paginada com filtros.
// ============================================================
import "server-only";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, users } from "@/db/schema";
import { paged, type PageParams, type Paged } from "@/lib/pagination";
import { eventsForCategory } from "@/lib/audit-events";

export async function log(
  event: string,
  meta: Record<string, unknown> = {},
  userId?: string,
  ipHash?: string
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      event,
      meta,
      userId: userId ?? null,
      ipHash: ipHash ?? null,
    });
  } catch {
    /* best-effort: auditoria não pode quebrar a requisição */
  }
}

export async function recent(limit = 100) {
  return db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(500, Math.max(1, limit)));
}

export interface AuditFilters {
  q?: string;
  category?: string;
  userId?: string;
  from?: Date;
  to?: Date; // exclusivo
}

export interface AuditItem {
  id: number;
  event: string;
  meta: Record<string, unknown> | null;
  ipHash: string | null;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

/** Lista paginada do log de auditoria (superadmin), com filtros + dono. */
export async function list(
  p: PageParams,
  opts: AuditFilters = {}
): Promise<Paged<AuditItem>> {
  const catEvents =
    opts.category && eventsForCategory(opts.category).length
      ? eventsForCategory(opts.category)
      : null;
  const like = opts.q && opts.q.trim() ? `%${opts.q.trim()}%` : null;

  const where = and(
    catEvents ? inArray(auditLog.event, catEvents) : undefined,
    opts.userId ? eq(auditLog.userId, opts.userId) : undefined,
    opts.from ? gte(auditLog.createdAt, opts.from) : undefined,
    opts.to ? lt(auditLog.createdAt, opts.to) : undefined,
    like
      ? or(
          ilike(auditLog.event, like),
          sql`${auditLog.meta}::text ilike ${like}`
        )
      : undefined
  );

  const items = await db
    .select({
      id: auditLog.id,
      event: auditLog.event,
      meta: auditLog.meta,
      ipHash: auditLog.ipHash,
      createdAt: auditLog.createdAt,
      userId: auditLog.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(p.limit)
    .offset(p.offset);

  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(where);

  return paged(items as AuditItem[], c ?? 0, p);
}
