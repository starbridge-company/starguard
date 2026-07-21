import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, prBatchSchema, parseGitHubRepo } from "@/lib/validation";
import { DEMO_MODE } from "@/lib/config";
import { audit } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(prBatchSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const ref = parseGitHubRepo(v.data.repoUrl)!;
  // Dedup por arquivo para reportar quantos arquivos serão de fato commitados.
  const uniqueFiles = new Set(v.data.files.map((f) => f.file.replace(/\\/g, "/")));

  if (DEMO_MODE) {
    const number = 100 + (Date.now() % 900);
    const branch = `starguard/fix-batch-${Date.now().toString(36)}`;
    audit("pr.batch.demo", {
      userId: session.sub,
      repo: `${ref.owner}/${ref.repo}`,
      files: uniqueFiles.size,
    });
    return jsonOk({
      number,
      url: `https://github.com/${ref.owner}/${ref.repo}/pull/${number}`,
      title: v.data.title,
      branch,
      committed: uniqueFiles.size,
      demo: true,
    });
  }

  try {
    const { openPullRequestBatch } = await import("@/lib/github");
    const pr = await openPullRequestBatch({
      repoUrl: v.data.repoUrl,
      files: v.data.files,
      title: v.data.title,
      body: v.data.body,
      token: v.data.token,
    });
    audit("pr.batch", {
      userId: session.sub,
      number: pr.number,
      committed: pr.committed,
    });
    return jsonOk(pr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao abrir o PR.";
    return jsonError(502, msg);
  }
}
