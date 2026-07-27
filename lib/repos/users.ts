// ============================================================
// Repositório de usuários (Drizzle). NODE-ONLY.
// ============================================================
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type UserRow, type Role } from "@/db/schema";
import { paged, type PageParams, type Paged } from "@/lib/pagination";

export async function findByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function findById(id: string): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

/** Existe algum usuário com este e-mail (inclusive soft-deleted)? */
export async function existsByEmail(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      role: input.role,
    })
    .returning();
  return row!;
}

export async function updateLastLogin(id: string): Promise<void> {
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, id));
}

/** Atualiza o próprio perfil (nome, e-mail/login e/ou hash de senha). */
export async function updateProfile(
  id: string,
  patch: { name?: string; email?: string; passwordHash?: string }
): Promise<UserRow | undefined> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) set.email = patch.email.toLowerCase();
  if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;
  const [row] = await db
    .update(users)
    .set(set)
    .where(eq(users.id, id))
    .returning();
  return row;
}

/** Semeia usuários demo de forma idempotente (não sobrescreve existentes). */
export async function ensureSeed(
  seedUsers: { email: string; name: string; passwordHash: string; role: Role }[]
): Promise<void> {
  if (seedUsers.length === 0) return;
  await db
    .insert(users)
    .values(
      seedUsers.map((u) => ({
        email: u.email.toLowerCase(),
        name: u.name,
        passwordHash: u.passwordHash,
        role: u.role,
      }))
    )
    .onConflictDoNothing({ target: users.email });
}

/**
 * Derruba todas as sessões abertas do usuário: o refresh passa a recusar
 * qualquer token emitido antes de agora. Usado em troca de papel, exclusão e
 * troca de senha/e-mail. Ver AUDITORIA.md#SEC-02 e #SEC-03.
 */
export async function invalidateSessions(id: string): Promise<void> {
  await db
    .update(users)
    .set({ sessionsInvalidatedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, id));
}

/**
 * Altera o papel de um usuário (superadmin) e derruba as sessões dele na
 * MESMA instrução — senão o token antigo continuaria emitindo acesso com o
 * papel anterior por até 7 dias.
 */
export async function updateRole(id: string, role: Role): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set({ role, sessionsInvalidatedAt: now, updatedAt: now })
    .where(eq(users.id, id));
}

/** Soft delete de um usuário. Retorna false se já estava excluído/não existe. */
export async function softDeleteUser(id: string): Promise<boolean> {
  const now = new Date();
  const res = await db
    .update(users)
    // Sem o corte de sessão, um usuário excluído continuaria renovando a
    // própria sessão pelos 7 dias de validade do refresh.
    .set({ deletedAt: now, sessionsInvalidatedAt: now, updatedAt: now })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ id: users.id });
  return res.length > 0;
}

export async function countUsers(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(isNull(users.deletedAt));
  return row?.c ?? 0;
}

export interface UserWithMetrics {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  analysesCount: number;
  totalFindings: number;
  criticalCount: number;
  prsCount: number;
  lastActivity: string | null;
}

/** Lista usuários com métricas agregadas por usuário (painel do superadmin). */
export async function listUsersWithMetrics(
  p: PageParams,
  q?: string
): Promise<Paged<UserWithMetrics>> {
  const like = q && q.trim() ? `%${q.trim()}%` : null;
  const filter = like
    ? sql`u.deleted_at is null and (u.email ilike ${like} or u.name ilike ${like})`
    : sql`u.deleted_at is null`;

  const rows = (
    await db.execute(sql`
      select
        u.id, u.email, u.name, u.role,
        u.created_at   as "createdAt",
        u.last_login_at as "lastLoginAt",
        count(distinct a.id)::int                     as "analysesCount",
        coalesce(sum(a.total_findings), 0)::int       as "totalFindings",
        coalesce(sum(a.critical_count), 0)::int       as "criticalCount",
        count(distinct p.id)::int                     as "prsCount",
        greatest(max(a.created_at), u.last_login_at)  as "lastActivity"
      from starguard.users u
      left join starguard.analyses a on a.user_id = u.id and a.deleted_at is null
      left join starguard.pull_requests p on p.user_id = u.id
      where ${filter}
      group by u.id
      order by count(distinct a.id) desc, u.created_at desc
      limit ${p.limit} offset ${p.offset}
    `)
  ).rows as unknown as UserWithMetrics[];

  const [{ c }] = (
    await db.execute(sql`
      select count(*)::int as c from starguard.users u where ${filter}
    `)
  ).rows as unknown as { c: number }[];

  return paged(rows, c, p);
}
