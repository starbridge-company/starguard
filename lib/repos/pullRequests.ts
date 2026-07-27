// ============================================================
// Repositório de Pull Requests abertos (rastreamento). NODE-ONLY.
// ============================================================
import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { analyses, pullRequests, type PullRequestRow } from "@/db/schema";
import { paged, type PageParams, type Paged } from "@/lib/pagination";

export async function createPR(input: {
  analysisId?: string | null;
  userId: string;
  repoUrl: string;
  number: number;
  url: string;
  title: string;
  branch: string;
  committedCount?: number;
}): Promise<PullRequestRow> {
  const [row] = await db
    .insert(pullRequests)
    .values({
      analysisId: input.analysisId ?? null,
      userId: input.userId,
      repoUrl: input.repoUrl,
      number: input.number,
      url: input.url,
      title: input.title,
      branch: input.branch,
      committedCount: input.committedCount ?? 1,
    })
    .returning();

  // Mantém o contador da análise em dia. Antes, `prs_count` só era calculado
  // no fim do job — quando ainda não existia PR nenhum — e ficava zerado para
  // sempre, contradizendo a tela /pull-requests. Ver AUDITORIA.md#BUG-08.
  if (input.analysisId) {
    await db
      .update(analyses)
      .set({
        prsCount: sql`${analyses.prsCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, input.analysisId))
      .catch(() => {
        /* o PR já foi aberto no GitHub: o contador não pode derrubar a resposta */
      });
  }

  return row!;
}

export async function listForUser(
  userId: string,
  p: PageParams
): Promise<Paged<PullRequestRow>> {
  const where = eq(pullRequests.userId, userId);
  const items = await db
    .select()
    .from(pullRequests)
    .where(where)
    .orderBy(desc(pullRequests.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(pullRequests)
    .where(where);
  return paged(items, c ?? 0, p);
}
