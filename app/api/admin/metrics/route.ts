import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireRole } from "@/lib/http";
import { ROLES } from "@/lib/config";
import { globalMetrics } from "@/lib/repos/analyses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KPIs globais (superadmin): agregados de usuários, análises, achados e PRs.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ROLES.superadmin);
  if (!session) return jsonError(403, "Acesso restrito.");
  const metrics = await globalMetrics();
  return jsonOk(metrics);
}
