import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession, canAccess } from "@/lib/http";
import { validate, uuidField } from "@/lib/validation";
import { getAnalysisOwner } from "@/lib/jobs";
import * as findingsRepo from "@/lib/repos/findings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estado dos achados de uma análise, indexado pelo id posicional ("V-3") que a
 * tela já usa. Análises criadas antes da tabela `findings` devolvem lista
 * vazia — a tela simplesmente não mostra estado. Ver AUDITORIA.md#FEAT-01.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const { id } = await params;
  if (!validate(uuidField, id).ok) {
    return jsonError(404, "Análise não encontrada.");
  }

  const owner = await getAnalysisOwner(id);
  if (!owner || !canAccess(session, owner)) {
    return jsonError(404, "Análise não encontrada.");
  }

  const items = await findingsRepo.listForAnalysis(id);
  return jsonOk({ items });
}
