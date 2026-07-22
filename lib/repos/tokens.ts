// ============================================================
// Repositório de tokens do GitHub (cifrados; múltiplos por usuário; soft
// delete). NODE-ONLY. O plaintext só sai daqui em getDecrypted(), server-side.
// ============================================================
import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubTokens } from "@/db/schema";
import { encryptToken, decryptToken, last4 } from "@/lib/crypto";
import { paged, type PageParams, type Paged } from "@/lib/pagination";

// Projeção segura — NUNCA inclui ciphertext/iv/authTag.
export interface TokenView {
  id: string;
  name: string;
  last4: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const VIEW = {
  id: githubTokens.id,
  name: githubTokens.name,
  last4: githubTokens.last4,
  createdAt: githubTokens.createdAt,
  lastUsedAt: githubTokens.lastUsedAt,
};

export async function listForUser(
  userId: string,
  p: PageParams
): Promise<Paged<TokenView>> {
  const where = and(
    eq(githubTokens.userId, userId),
    isNull(githubTokens.deletedAt)
  );
  const items = await db
    .select(VIEW)
    .from(githubTokens)
    .where(where)
    .orderBy(desc(githubTokens.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(githubTokens)
    .where(where);
  return paged(items, c ?? 0, p);
}

/** Versão enxuta para o seletor de token na tela de Nova Análise. */
export async function listActiveBrief(
  userId: string,
  cap = 50
): Promise<Pick<TokenView, "id" | "name" | "last4">[]> {
  return db
    .select({ id: githubTokens.id, name: githubTokens.name, last4: githubTokens.last4 })
    .from(githubTokens)
    .where(and(eq(githubTokens.userId, userId), isNull(githubTokens.deletedAt)))
    .orderBy(desc(githubTokens.createdAt))
    .limit(cap);
}

export async function createToken(
  userId: string,
  name: string,
  plainToken: string
): Promise<TokenView> {
  const enc = encryptToken(plainToken);
  const [row] = await db
    .insert(githubTokens)
    .values({
      userId,
      name,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      last4: last4(plainToken),
    })
    .returning(VIEW);
  return row!;
}

/** Soft delete restrito ao dono. Retorna true se marcou algo. */
export async function softDelete(
  userId: string,
  id: string
): Promise<boolean> {
  const res = await db
    .update(githubTokens)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(githubTokens.id, id),
        eq(githubTokens.userId, userId),
        isNull(githubTokens.deletedAt)
      )
    )
    .returning({ id: githubTokens.id });
  return res.length > 0;
}

/**
 * Decifra o token de um id pertencente ao usuário. Marca lastUsedAt.
 * Retorna null se não existir/for de outro usuário/estiver deletado.
 */
export async function getDecrypted(
  userId: string,
  id: string
): Promise<string | null> {
  const rows = await db
    .select({
      ciphertext: githubTokens.ciphertext,
      iv: githubTokens.iv,
      authTag: githubTokens.authTag,
    })
    .from(githubTokens)
    .where(
      and(
        eq(githubTokens.id, id),
        eq(githubTokens.userId, userId),
        isNull(githubTokens.deletedAt)
      )
    )
    .limit(1);
  if (!rows[0]) return null;
  try {
    const plain = decryptToken(rows[0]);
    void db
      .update(githubTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(githubTokens.id, id))
      .catch(() => {});
    return plain;
  } catch {
    return null;
  }
}
