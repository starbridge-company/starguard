import type { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  requireSession,
  requireCsrf,
  canAccess,
} from "@/lib/http";
import { validate, uuidField } from "@/lib/validation";
import { getAnalysisOwner } from "@/lib/jobs";
import { audit } from "@/lib/auth";
import * as analysesRepo from "@/lib/repos/analyses";

export const runtime = "nodejs";

/**
 * Exclui uma análise (soft delete).
 *
 * A coluna `analyses.deleted_at` existia e era filtrada em toda consulta, mas
 * nenhuma rota a preenchia — o usuário não tinha como apagar nada.
 * Ver AUDITORIA.md#BUG-22.
 *
 * Soft delete de propósito: a trilha de auditoria e os achados continuam
 * ligados à linha; o que muda é que ela some das listagens e das leituras.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const { id } = await params;
  if (!validate(uuidField, id).ok) {
    return jsonError(404, "Análise não encontrada.");
  }

  // Mesma resposta para "não existe" e "não é sua": não confirmamos a
  // existência de análise alheia.
  const owner = await getAnalysisOwner(id);
  if (!owner || !canAccess(session, owner)) {
    return jsonError(404, "Análise não encontrada.");
  }

  const excluiu = await analysesRepo.softDelete(id);
  if (!excluiu) return jsonError(404, "Análise não encontrada.");

  audit("analysis.delete", { userId: session.sub, analysisId: id });
  return jsonOk({ ok: true });
}
