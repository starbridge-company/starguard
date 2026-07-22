import type { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  readJson,
  requireRole,
  requireCsrf,
} from "@/lib/http";
import { ROLES } from "@/lib/config";
import { parsePageParams } from "@/lib/pagination";
import { validate, userCreateSchema } from "@/lib/validation";
import { hashPassword, audit } from "@/lib/auth";
import * as usersRepo from "@/lib/repos/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Todos os usuários com métricas agregadas por usuário (superadmin), paginado.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ROLES.superadmin);
  if (!session) return jsonError(403, "Acesso restrito.");

  const sp = req.nextUrl.searchParams;
  const p = parsePageParams(sp);
  const page = await usersRepo.listUsersWithMetrics(p, sp.get("q") || undefined);
  return jsonOk(page);
}

// Cria um novo usuário (superadmin escolhe o papel: superadmin ou admin).
export async function POST(req: NextRequest) {
  const session = await requireRole(req, ROLES.superadmin);
  if (!session) return jsonError(403, "Acesso restrito.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(userCreateSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  if (await usersRepo.existsByEmail(v.data.email)) {
    return jsonError(409, "Já existe um usuário com este e-mail.");
  }

  try {
    const passwordHash = await hashPassword(v.data.password);
    const user = await usersRepo.createUser({
      email: v.data.email,
      name: v.data.name,
      passwordHash,
      role: v.data.role,
    });
    audit("user.create", {
      by: session.sub,
      userId: user.id,
      role: user.role,
    });
    return jsonOk(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      201
    );
  } catch (e) {
    // Corrida na unicidade do e-mail (índice único).
    if ((e as { code?: string })?.code === "23505") {
      return jsonError(409, "Já existe um usuário com este e-mail.");
    }
    const msg = e instanceof Error ? e.message : "Falha ao criar o usuário.";
    return jsonError(500, msg);
  }
}
