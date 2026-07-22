import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession } from "@/lib/http";
import { findById } from "@/lib/repos/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const user = await findById(session.sub);
  if (!user) return jsonError(404, "Usuário não encontrado.");

  return jsonOk({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}
