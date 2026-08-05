import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession, requireCsrf } from "@/lib/http";
import { validate, uuidField } from "@/lib/validation";
import { audit, hashIp } from "@/lib/auth";
import { clientIp } from "@/lib/ratelimit";
import { ownerOf, revokeSession } from "@/lib/oauth/sessions";

export const runtime = "nodejs";

/**
 * Revoga o acesso de um dispositivo conectado.
 *
 * É a contrapartida obrigatória de emitir credencial de trinta dias: quem
 * conectou precisa conseguir desconectar sem pedir para ninguém. Também é a
 * ação que fecha um incidente de `oauth.reuse_detected`.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.", "err.csrf");

  const { id } = await params;
  const idCheck = validate(uuidField, id);
  if (!idCheck.ok) return jsonError(404, "Sessão não encontrada.", "err.notFound");

  // Dono confere ANTES de revogar, e a resposta é a mesma para "não é sua" e
  // "não existe": distinguir as duas diria a um curioso quais ids existem.
  const dono = await ownerOf(id);
  if (dono !== session.sub) return jsonError(404, "Sessão não encontrada.", "err.notFound");

  await revokeSession(id, "user");
  audit("oauth.revoke", { sessionId: id }, session.sub, hashIp(clientIp(req.headers)));
  return jsonOk({ ok: true });
}
