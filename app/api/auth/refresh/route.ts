import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { verifyToken } from "@/lib/jwt";
import {
  issueSession,
  setSessionCookies,
  revokeRefresh,
  isRefreshRevoked,
  audit,
  type User,
} from "@/lib/auth";
import { COOKIE } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE.refresh)?.value;
  if (!token) return jsonError(401, "Sessão expirada.");

  const claims = await verifyToken(token);
  if (!claims || claims.type !== "refresh" || !claims.jti) {
    return jsonError(401, "Sessão inválida.");
  }
  if (isRefreshRevoked(claims.jti)) {
    return jsonError(401, "Sessão revogada.");
  }

  // Rotação: revoga o refresh atual e emite um novo par.
  revokeRefresh(claims.jti);
  const user: User = {
    id: claims.sub,
    email: claims.email,
    role: claims.role,
    passwordHash: "",
  };
  const session = await issueSession(user);
  const res = jsonOk({ ok: true, csrf: session.csrf });
  setSessionCookies(res, session);
  audit("token.refresh", { userId: user.id });
  return res;
}
