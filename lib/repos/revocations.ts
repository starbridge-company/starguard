// ============================================================
// Blocklist de refresh tokens (rotação/logout) — persistida para funcionar
// em múltiplas instâncias. NODE-ONLY.
// ============================================================
import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { revokedTokens } from "@/db/schema";

export async function revoke(
  jti: string,
  userId?: string,
  expiresAt?: Date
): Promise<void> {
  // Se não veio expiração, assume o TTL padrão do refresh (7 dias).
  const exp = expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db
    .insert(revokedTokens)
    .values({ jti, userId: userId ?? null, expiresAt: exp })
    .onConflictDoNothing({ target: revokedTokens.jti });
}

export async function isRevoked(jti: string): Promise<boolean> {
  const rows = await db
    .select({ jti: revokedTokens.jti })
    .from(revokedTokens)
    .where(eq(revokedTokens.jti, jti))
    .limit(1);
  return rows.length > 0;
}

/** Limpa revogações já expiradas (chamável por rotina/cron). */
export async function purgeExpired(): Promise<number> {
  const res = await db
    .delete(revokedTokens)
    .where(lt(revokedTokens.expiresAt, sql`now()`))
    .returning({ jti: revokedTokens.jti });
  return res.length;
}
