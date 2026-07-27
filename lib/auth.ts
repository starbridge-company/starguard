// ============================================================
// Auth NODE-ONLY: Argon2id (hash/verify), usuários no Postgres, sessão,
// blocklist de refresh (DB) e log de auditoria (DB). NÃO importar no
// middleware (edge) — use lib/jwt.ts lá.
// ============================================================
import "server-only";
import { createHash } from "node:crypto";
import argon2, { type HashOptions } from "argon2";
import type { NextRequest, NextResponse } from "next/server";
import {
  ARGON,
  COOKIE,
  SESSION_SECURE,
  SEED_SUPERADMIN,
  SEED_ADMIN,
  type Role,
} from "@/lib/config";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type SessionClaims,
} from "@/lib/jwt";
import * as usersRepo from "@/lib/repos/users";
import * as revocations from "@/lib/repos/revocations";
import * as auditRepo from "@/lib/repos/audit";

// Visão mínima de usuário usada pela sessão (compat com o restante do código).
export interface User {
  id: string;
  email: string;
  role: string;
  name?: string;
  passwordHash?: string;
}

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

// ---- Seed idempotente dos usuários iniciais (uma vez por processo) ----
const g = globalThis as unknown as { __sg_seed?: Promise<void> };

async function seedOnce(): Promise<void> {
  const seeds = [SEED_SUPERADMIN, SEED_ADMIN];
  const withHashes = await Promise.all(
    seeds.map(async (s) => ({
      email: s.email,
      name: s.name,
      role: s.role as Role,
      passwordHash: await hashPassword(s.password),
    }))
  );
  await usersRepo.ensureSeed(withHashes);
}

async function ensureSeeded(): Promise<void> {
  if (!g.__sg_seed) {
    g.__sg_seed = seedOnce().catch((e) => {
      // Não fixa o flag em caso de falha (DB indisponível): tenta de novo depois.
      g.__sg_seed = undefined;
      throw e;
    });
  }
  return g.__sg_seed;
}

export async function findUser(email: string): Promise<User | undefined> {
  await ensureSeeded();
  const row = await usersRepo.findByEmail(email);
  return row
    ? {
        id: row.id,
        email: row.email,
        role: row.role,
        name: row.name,
        passwordHash: row.passwordHash,
      }
    : undefined;
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
  if (ok && user) {
    void usersRepo.updateLastLogin(user.id).catch(() => {});
    return user;
  }
  return null;
}

// ---- Blocklist (revogação de refresh no logout/rotação) — persistida ----
export async function revokeRefresh(
  jti: string,
  opts?: { userId?: string; expiresAt?: Date }
): Promise<void> {
  await revocations.revoke(jti, opts?.userId, opts?.expiresAt);
}
export async function isRefreshRevoked(jti: string): Promise<boolean> {
  return revocations.isRevoked(jti);
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

export function setSessionCookies(res: NextResponse, s: IssuedSession): void {
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

/**
 * Pseudonimiza o IP para a trilha de auditoria. IP é dado pessoal (LGPD) e não
 * pode ser gravado em claro — mas ainda precisamos correlacionar eventos da
 * mesma origem, então guardamos um hash com sal fixo do servidor.
 * O sal NUNCA vai ao banco: sem ele o hash não volta a ser IP.
 */
export function hashIp(ip: string): string {
  const salt =
    process.env.AUDIT_IP_SALT || process.env.COOKIE_SECRET || "starguard-dev";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

// ---- Auditoria (persistida; best-effort, nunca lança) ----
export function audit(
  event: string,
  meta: Record<string, unknown> = {},
  userId?: string,
  ipHash?: string
): void {
  // Log estruturado, nunca senhas/tokens.
  console.log(`[audit] ${event}`, JSON.stringify(meta));
  void auditRepo.log(event, meta, userId ?? (meta.userId as string | undefined), ipHash);
}

export async function auditTrail() {
  return auditRepo.recent(100);
}
