import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession, canAccess } from "@/lib/http";
import { getAnalysisWithOwner } from "@/lib/jobs";
import { validate, uuidField } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const { id } = await params;
  const idCheck = validate(uuidField, id);
  if (!idCheck.ok) return jsonError(404, "Análise não encontrada.");

  const analysis = await getAnalysisWithOwner(id);
  if (!analysis) return jsonError(404, "Análise não encontrada.");
  // Dono ou superadmin (que enxerga tudo de todos).
  if (!canAccess(session, analysis.owner)) {
    return jsonError(404, "Análise não encontrada.");
  }
  return jsonOk(analysis.job);
}
