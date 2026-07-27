import type { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  readJson,
  requireSession,
  requireCsrf,
  canAccess,
} from "@/lib/http";
import { validate, uuidField, findingStatusSchema } from "@/lib/validation";
import { audit } from "@/lib/auth";
import * as findingsRepo from "@/lib/repos/findings";

export const runtime = "nodejs";

/** Marca o achado como corrigido, falso positivo, risco aceito etc. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const { id } = await params;
  if (!validate(uuidField, id).ok) return jsonError(404, "Achado não encontrado.");

  const v = validate(findingStatusSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const owner = await findingsRepo.ownerOfFinding(id);
  if (!owner || !canAccess(session, owner)) {
    return jsonError(404, "Achado não encontrado.");
  }

  await findingsRepo.setStatus(id, v.data.status, session.sub, v.data.note);
  audit("finding.status", {
    userId: session.sub,
    findingId: id,
    status: v.data.status,
  });
  return jsonOk({ ok: true, status: v.data.status });
}
