import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireRole } from "@/lib/http";
import { ROLES } from "@/lib/config";
import { parsePageParams } from "@/lib/pagination";
import * as auditRepo from "@/lib/repos/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(v: string | null, endExclusive = false): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return undefined;
  if (endExclusive) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// Log de auditoria completo (superadmin), paginado + filtros.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ROLES.superadmin);
  if (!session) return jsonError(403, "Acesso restrito.");

  const sp = req.nextUrl.searchParams;
  const p = parsePageParams(sp);
  const page = await auditRepo.list(p, {
    q: sp.get("q") || undefined,
    category: sp.get("category") || undefined,
    userId: sp.get("userId") || undefined,
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to"), true),
  });
  return jsonOk(page);
}
