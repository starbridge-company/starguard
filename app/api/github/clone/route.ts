import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, cloneSchema } from "@/lib/validation";

export const runtime = "nodejs";

// Retorna metadados do repositório (valida SSRF/allowlist github.com).
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(cloneSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  try {
    const { getRepoMeta } = await import("@/lib/github");
    const meta = await getRepoMeta(v.data.repoUrl, v.data.token);
    return jsonOk(meta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao acessar o repositório.";
    return jsonError(502, msg);
  }
}
