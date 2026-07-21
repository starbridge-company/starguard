import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, analyzeSchema } from "@/lib/validation";
import { createJob, startJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(analyzeSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const job = createJob({
    projectName: v.data.projectName,
    systemDescription: v.data.systemDescription,
    repoUrl: v.data.repoUrl || undefined,
    token: v.data.token || undefined,
    skills: v.data.skills || [],
  });

  startJob(job.id);
  return jsonOk({ id: job.id }, 201);
}
