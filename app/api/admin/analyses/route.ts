import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireRole } from "@/lib/http";
import { ROLES } from "@/lib/config";
import { parsePageParams } from "@/lib/pagination";
import { parseAnalysisFilters } from "@/lib/filters";
import * as analysesRepo from "@/lib/repos/analyses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODAS as análises de todos os usuários (superadmin), paginado + filtros.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ROLES.superadmin);
  if (!session) return jsonError(403, "Acesso restrito.");

  const sp = req.nextUrl.searchParams;
  const p = parsePageParams(sp);
  const page = await analysesRepo.listAll(p, {
    ...parseAnalysisFilters(sp),
    userId: sp.get("userId") || undefined,
  });
  return jsonOk(page);
}
