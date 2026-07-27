import type { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  readJson,
  requireRole,
  requireCsrf,
} from "@/lib/http";
import { ROLES } from "@/lib/config";
import { validate, roleUpdateSchema, uuidField } from "@/lib/validation";
import { audit } from "@/lib/auth";
import * as usersRepo from "@/lib/repos/users";

export const runtime = "nodejs";

// Altera o papel de um usuário (superadmin) — inclusive de outro superadmin.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole(req, ROLES.superadmin);
  if (!session) return jsonError(403, "Acesso restrito.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.", "err.csrf");

  const { id } = await params;
  if (!validate(uuidField, id).ok) return jsonError(404, "Usuário não encontrado.");
  // Guarda: não permitir rebaixar/alterar o próprio papel (evita auto-lockout).
  if (id === session.sub) {
    return jsonError(400, "Não é possível alterar o próprio papel.", "err.cannotChangeOwnRole");
  }

  const v = validate(roleUpdateSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message, null);

  const target = await usersRepo.findById(id);
  if (!target) return jsonError(404, "Usuário não encontrado.");

  await usersRepo.updateRole(id, v.data.role);
  audit("user.role.update", {
    by: session.sub,
    userId: id,
    role: v.data.role,
  });
  return jsonOk({ id, role: v.data.role });
}

// Soft delete de um usuário (superadmin) — inclusive outro superadmin.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRole(req, ROLES.superadmin);
  if (!session) return jsonError(403, "Acesso restrito.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.", "err.csrf");

  const { id } = await params;
  if (!validate(uuidField, id).ok) return jsonError(404, "Usuário não encontrado.");
  if (id === session.sub) {
    return jsonError(400, "Não é possível excluir a própria conta.", "err.cannotDeleteOwnAccount");
  }

  const ok = await usersRepo.softDeleteUser(id);
  if (!ok) return jsonError(404, "Usuário não encontrado.");

  audit("user.delete", { by: session.sub, userId: id });
  return jsonOk({ ok: true });
}
