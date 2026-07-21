import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, prSchema, parseGitHubRepo } from "@/lib/validation";
import { DEMO_MODE } from "@/lib/config";
import { audit } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(prSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const ref = parseGitHubRepo(v.data.repoUrl)!;

  if (DEMO_MODE) {
    const number = 100 + (Date.now() % 900);
    const branch = `starguard/fix-${Date.now().toString(36)}`;
    audit("pr.open.demo", { userId: session.sub, repo: `${ref.owner}/${ref.repo}` });
    return jsonOk({
      number,
      url: `https://github.com/${ref.owner}/${ref.repo}/pull/${number}`,
      title: v.data.title,
      branch,
      demo: true,
    });
  }

  try {
    const { openPullRequest } = await import("@/lib/github");
    const pr = await openPullRequest({
      repoUrl: v.data.repoUrl,
      file: v.data.file,
      fixedCode: v.data.fixedCode,
      title: v.data.title,
      body: v.data.body,
      token: v.data.token,
    });
    audit("pr.open", { userId: session.sub, number: pr.number });
    return jsonOk(pr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao abrir o PR.";
    return jsonError(502, msg);
  }
}
