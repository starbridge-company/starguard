import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession } from "@/lib/http";
import { parsePageParams } from "@/lib/pagination";
import * as prRepo from "@/lib/repos/pullRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pull Requests abertos pelo próprio usuário (paginado).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  const p = parsePageParams(req.nextUrl.searchParams);
  const page = await prRepo.listForUser(session.sub, p);
  return jsonOk(page);
}
