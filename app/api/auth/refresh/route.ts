import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { verifyToken } from "@/lib/jwt";
import {
  issueSession,
  setSessionCookies,
  revokeRefresh,
  isRefreshRevoked,
  audit,
  hashIp,
  type User,
} from "@/lib/auth";
import { clientIp } from "@/lib/ratelimit";
import * as usersRepo from "@/lib/repos/users";
import { COOKIE } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE.refresh)?.value;
  if (!token) return jsonError(401, "Sessão expirada.");

  const claims = await verifyToken(token);
  if (!claims || claims.type !== "refresh" || !claims.jti) {
    return jsonError(401, "Sessão inválida.");
  }
  if (await isRefreshRevoked(claims.jti)) {
    return jsonError(401, "Sessão revogada.");
  }

  // O usuário é lido do BANCO, não das claims. Antes, o refresh reconstruía a
  // sessão a partir do próprio token: conta excluída continuava entrando e
  // papel rebaixado continuava valendo por até 7 dias. Ver AUDITORIA.md#SEC-02.
  const fresh = await usersRepo.findById(claims.sub); // já filtra deletedAt
  if (!fresh) return jsonError(401, "Sessão inválida.");

  // Corte de sessão (troca de papel, exclusão, troca de senha). `iat` do JWT
  // tem precisão de SEGUNDOS: comparamos em segundos para que a sessão nova,
  // emitida no mesmo segundo do corte, não se auto-invalide.
  if (fresh.sessionsInvalidatedAt) {
    const cutoff = Math.floor(fresh.sessionsInvalidatedAt.getTime() / 1000);
    if (claims.iat < cutoff) {
      await revokeRefresh(claims.jti, {
        userId: claims.sub,
        expiresAt: new Date(claims.exp * 1000),
      });
      return jsonError(401, "Sessão encerrada. Entre novamente.");
    }
  }

  // Rotação: revoga o refresh atual e emite um novo par.
  await revokeRefresh(claims.jti, {
    userId: claims.sub,
    expiresAt: new Date(claims.exp * 1000),
  });
  const user: User = {
    id: fresh.id,
    email: fresh.email,
    role: fresh.role, // papel ATUAL, não o que estava no token
  };
  const session = await issueSession(user);
  const res = jsonOk({ ok: true, csrf: session.csrf });
  setSessionCookies(res, session);
  audit("token.refresh", { userId: user.id }, user.id, hashIp(clientIp(req.headers)));
  return res;
}
