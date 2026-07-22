import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession } from "@/lib/http";
import { parsePageParams } from "@/lib/pagination";
import { parseAnalysisFilters } from "@/lib/filters";
import * as analysesRepo from "@/lib/repos/analyses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Histórico de análises do próprio usuário (paginado, com filtros).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const sp = req.nextUrl.searchParams;
  const p = parsePageParams(sp);
  const page = await analysesRepo.listForUser(
    session.sub,
    p,
    parseAnalysisFilters(sp)
  );
  return jsonOk(page);
}
