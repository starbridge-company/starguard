// ============================================================
// Helpers de resposta para as API Routes — sempre no-store + nosniff,
// e mensagens de erro genéricas (sem stack trace pro cliente).
// ============================================================
import { NextResponse, type NextRequest } from "next/server";
import { getSession, checkCsrf } from "@/lib/auth";
import type { SessionClaims } from "@/lib/jwt";
import { ROLES, type Role } from "@/lib/config";

function harden(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return harden(NextResponse.json(data, { status }));
}

export function jsonError(status: number, message: string): NextResponse {
  return harden(NextResponse.json({ error: message }, { status }));
}

/** Lê a sessão; retorna claims ou null. Middleware já barra, isto é defesa extra. */
export async function requireSession(
  req: NextRequest
): Promise<SessionClaims | null> {
  return getSession(req);
}

/** Valida CSRF (double-submit) para métodos que mudam estado. */
export function requireCsrf(req: NextRequest): boolean {
  return checkCsrf(req);
}

/**
 * Exige uma sessão com o papel informado. Superadmin passa em qualquer
 * exigência (vê tudo). Retorna as claims ou null (o chamador responde 401/403).
 *
 * O papel é reconferido no BANCO, não só na claim: o access token vale 15 min,
 * então um superadmin rebaixado (ou excluído) ainda carrega o papel antigo no
 * token até ele expirar. Como só a área de governança passa por aqui, o custo
 * de uma consulta por requisição é aceitável. Ver AUDITORIA.md#SEC-02.
 */
export async function requireRole(
  req: NextRequest,
  role: Role
): Promise<SessionClaims | null> {
  const s = await getSession(req);
  if (!s) return null;

  const { findById } = await import("@/lib/repos/users");
  const fresh = await findById(s.sub).catch(() => undefined); // já filtra deletedAt
  if (!fresh) return null;

  if (fresh.role === ROLES.superadmin || fresh.role === role) {
    // Devolve o papel atual — o restante da rota não deve ler a claim velha.
    return { ...s, role: fresh.role };
  }
  return null;
}

export function isSuperadmin(s: SessionClaims | null | undefined): boolean {
  return s?.role === ROLES.superadmin;
}

/** Dono do recurso OU superadmin (que enxerga tudo de todos). */
export function canAccess(
  s: SessionClaims,
  ownerId: string
): boolean {
  return s.role === ROLES.superadmin || s.sub === ownerId;
}

/** Lê e faz JSON.parse do body com limite defensivo. */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
