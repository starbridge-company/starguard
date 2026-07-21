// ============================================================
// Helpers de resposta para as API Routes — sempre no-store + nosniff,
// e mensagens de erro genéricas (sem stack trace pro cliente).
// ============================================================
import { NextResponse, type NextRequest } from "next/server";
import { getSession, checkCsrf } from "@/lib/auth";
import type { SessionClaims } from "@/lib/jwt";

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

/** Lê e faz JSON.parse do body com limite defensivo. */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
