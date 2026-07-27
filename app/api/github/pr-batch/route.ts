import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, prBatchSchema } from "@/lib/validation";
import { redact } from "@/lib/redact";
import { audit } from "@/lib/auth";
import * as prRepo from "@/lib/repos/pullRequests";
import { getDecrypted } from "@/lib/repos/tokens";
import { getAnalysisOwner } from "@/lib/jobs";

export const runtime = "nodejs";

async function ownedAnalysisId(
  analysisId: string | undefined,
  userId: string
): Promise<string | undefined> {
  if (!analysisId) return undefined;
  const owner = await getAnalysisOwner(analysisId);
  return owner === userId ? analysisId : undefined;
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(prBatchSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const analysisId = await ownedAnalysisId(v.data.analysisId, session.sub);

  try {
    let token = v.data.token;
    if (v.data.tokenId) {
      token = (await getDecrypted(session.sub, v.data.tokenId)) ?? undefined;
    }
    const { openPullRequestBatch } = await import("@/lib/github");
    const pr = await openPullRequestBatch({
      repoUrl: v.data.repoUrl,
      files: v.data.files,
      title: v.data.title,
      body: v.data.body,
      token,
    });
    await prRepo
      .createPR({
        analysisId,
        userId: session.sub,
        repoUrl: v.data.repoUrl,
        number: pr.number,
        url: pr.url,
        title: pr.title,
        branch: pr.branch,
        committedCount: pr.committed,
      })
      .catch(() => {});
    audit("pr.batch", {
      userId: session.sub,
      number: pr.number,
      committed: pr.committed,
    });
    return jsonOk(pr);
  } catch (e) {
    const msg = e instanceof Error ? redact(e.message) : "Falha ao abrir o PR.";
    return jsonError(502, msg);
  }
}
