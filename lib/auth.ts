// ============================================================
// Auth NODE-ONLY: Argon2id (hash/verify), user store, sessão,
// blocklist de refresh e log de auditoria. NÃO importar no middleware
// (edge) — use lib/jwt.ts lá.
// ============================================================
import "server-only";
import argon2, { type HashOptions } from "argon2";
import type { NextRequest, NextResponse } from "next/server";
import { ARGON, COOKIE, SESSION_SECURE, DEMO_USER } from "@/lib/config";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type SessionClaims,
} from "@/lib/jwt";

// ---- User store (MVP: memória; troque por DB em prod) ----
export interface User {
  id: string;
  email: string;
  role: string;
  passwordHash: string;
}

interface AuthState {
  users?: Map<string, User>;
  revoked?: Set<string>; // jti de refresh revogados
  audit?: { ts: number; event: string; meta: Record<string, unknown> }[];
  seeded?: boolean;
}

const g = globalThis as unknown as { __sg_auth?: AuthState };
g.__sg_auth ||= {};
g.__sg_auth.users ||= new Map();
g.__sg_auth.revoked ||= new Set();
g.__sg_auth.audit ||= [];

const ARGON_OPTS: HashOptions = {
  type: argon2.argon2id,
  memoryCost: ARGON.memoryCost,
  timeCost: ARGON.timeCost,
  parallelism: ARGON.parallelism,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTS);
}

export async function verifyPassword(
  hash: string,
  plain: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Semeia o usuário demo (hash Argon2id derivado em runtime — nunca em texto puro).
async function ensureSeeded(): Promise<void> {
  if (g.__sg_auth!.seeded) return;
  const email = DEMO_USER.email.toLowerCase();
  if (!g.__sg_auth!.users!.has(email)) {
    g.__sg_auth!.users!.set(email, {
      id: "u_demo",
      email,
      role: DEMO_USER.role,
      passwordHash: await hashPassword(DEMO_USER.password),
    });
  }
  g.__sg_auth!.seeded = true;
}

export async function findUser(email: string): Promise<User | undefined> {
  await ensureSeeded();
  return g.__sg_auth!.users!.get(email.toLowerCase());
}

/** Verifica credenciais. Retorna o usuário ou null (mensagem genérica no chamador). */
export async function authenticate(
  email: string,
  password: string
): Promise<User | null> {
  const user = await findUser(email);
  // Sempre executa um verify (mesmo sem usuário) para reduzir timing oracle.
  const hash =
    user?.passwordHash ||
    "$argon2id$v=19$m=19456,t=3,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000";
  const ok = await verifyPassword(hash, password);
  return ok && user ? user : null;
}

// ---- Blocklist (revogação de refresh no logout) ----
export function revokeRefresh(jti: string): void {
  g.__sg_auth!.revoked!.add(jti);
}
export function isRefreshRevoked(jti: string): boolean {
  return g.__sg_auth!.revoked!.has(jti);
}

// ---- Sessão / cookies ----
export interface IssuedSession {
  access: string;
  refresh: string;
  csrf: string;
  refreshJti: string;
}

export async function issueSession(user: User): Promise<IssuedSession> {
  const refreshJti = crypto.randomUUID();
  const base = { sub: user.id, email: user.email, role: user.role };
  const [access, refresh] = await Promise.all([
    signAccessToken(base),
    signRefreshToken(base, refreshJti),
  ]);
  const csrf = crypto.randomUUID();
  return { access, refresh, csrf, refreshJti };
}

const baseCookie = {
  httpOnly: true,
  secure: SESSION_SECURE,
  sameSite: "strict" as const,
  path: "/",
};

export function setSessionCookies(
  res: NextResponse,
  s: IssuedSession
): void {
  res.cookies.set(COOKIE.access, s.access, { ...baseCookie, maxAge: 60 * 15 });
  res.cookies.set(COOKIE.refresh, s.refresh, {
    ...baseCookie,
    maxAge: 60 * 60 * 24 * 7,
  });
  // CSRF precisa ser legível por JS (double-submit) -> httpOnly false.
  res.cookies.set(COOKIE.csrf, s.csrf, {
    ...baseCookie,
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookies(res: NextResponse): void {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.csrf]) {
    res.cookies.set(name, "", { ...baseCookie, httpOnly: false, maxAge: 0 });
  }
}

/** Lê e valida a sessão (access token) de um request. */
export async function getSession(
  req: NextRequest
): Promise<SessionClaims | null> {
  const token = req.cookies.get(COOKIE.access)?.value;
  if (!token) return null;
  const claims = await verifyToken(token);
  if (!claims || claims.type !== "access") return null;
  return claims;
}

/** Double-submit CSRF: header x-csrf-token deve bater com o cookie. */
export function checkCsrf(req: NextRequest): boolean {
  const cookie = req.cookies.get(COOKIE.csrf)?.value;
  const header = req.headers.get("x-csrf-token");
  return !!cookie && !!header && cookie === header;
}

// ---- Auditoria (sem dados sensíveis) ----
export function audit(event: string, meta: Record<string, unknown> = {}): void {
  const entry = { ts: Date.now(), event, meta };
  g.__sg_auth!.audit!.push(entry);
  if (g.__sg_auth!.audit!.length > 500) g.__sg_auth!.audit!.shift();
  // Log estruturado, nunca senhas/tokens.
  console.log(`[audit] ${event}`, JSON.stringify(meta));
}

export function auditTrail() {
  return g.__sg_auth!.audit!.slice(-100);
}
