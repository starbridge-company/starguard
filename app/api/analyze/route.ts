import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, analyzeSchema } from "@/lib/validation";
import { createAnalysis, startJob } from "@/lib/jobs";
import { getLocale } from "@/lib/i18n/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(analyzeSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const id = await createAnalysis(session.sub, {
    // Idioma do usuário: define em que língua a IA escreve nesta análise.
    locale: await getLocale(),
    projectName: v.data.projectName,
    systemDescription: v.data.systemDescription,
    repoUrl: v.data.repoUrl || undefined,
    token: v.data.token || undefined,
    tokenId: v.data.tokenId || undefined,
    saveToken: v.data.saveToken || undefined,
    tokenName: v.data.tokenName || undefined,
    skills: v.data.skills || [],
  });

  startJob(id);
  return jsonOk({ id }, 201);
}
