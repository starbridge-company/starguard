import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession, requireCsrf } from "@/lib/http";
import { validate, uuidField } from "@/lib/validation";
import { audit } from "@/lib/auth";
import * as tokensRepo from "@/lib/repos/tokens";

export const runtime = "nodejs";

// Soft delete de um token da conta (restrito ao dono).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const { id } = await params;
  const idCheck = validate(uuidField, id);
  if (!idCheck.ok) return jsonError(404, "Token não encontrado.");

  const ok = await tokensRepo.softDelete(session.sub, id);
  if (!ok) return jsonError(404, "Token não encontrado.");

  audit("token.delete", { userId: session.sub, tokenId: id });
  return jsonOk({ ok: true });
}
