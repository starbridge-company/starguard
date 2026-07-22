import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession, canAccess } from "@/lib/http";
import { getAnalysis, getAnalysisOwner } from "@/lib/jobs";
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

  const owner = await getAnalysisOwner(id);
  if (!owner) return jsonError(404, "Análise não encontrada.");
  // Dono ou superadmin (que enxerga tudo de todos).
  if (!canAccess(session, owner)) return jsonError(404, "Análise não encontrada.");

  const job = await getAnalysis(id);
  if (!job) return jsonError(404, "Análise não encontrada.");
  return jsonOk(job);
}
