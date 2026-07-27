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

/**
 * Erro de API. Devolve `error` (texto pronto, compatível com o que já existia)
 * e `errorKey` — uma chave estável que o cliente traduz para o idioma do
 * usuário. Sem a chave, toda mensagem ficaria presa em pt-BR.
 * Ver AUDITORIA.md#PEND-17.
 *
 * `errorKey: null` diz "esta mensagem é DINÂMICA — não a substitua". É o caso
 * do erro redigido de uma ferramenta externa e do detalhe do Zod: não existe
 * chave que os represente, e trocá-los por um "Erro no servidor." genérico
 * apagaria a única informação útil que o usuário tem para agir.
 */
export function jsonError(
  status: number,
  message: string,
  errorKey?: string | null
): NextResponse {
  const body: { error: string; errorKey?: string } = { error: message };
  if (errorKey !== null) body.errorKey = errorKey ?? keyFor(status);
  return harden(NextResponse.json(body, { status }));
}

/** Chave genérica por status, quando a rota não informa uma específica. */
function keyFor(status: number): string {
  if (status === 401) return "err.unauthenticated";
  if (status === 403) return "err.forbidden";
  if (status === 404) return "err.notFound";
  if (status === 409) return "err.conflict";
  if (status === 429) return "err.tooManyRequests";
  if (status >= 500) return "err.server";
  return "err.badRequest";
}

/**
 * Cache curto de contas ainda válidas.
 *
 * `requireSession` roda em TODA rota da API; consultar o banco a cada
 * requisição era caro demais, e por isso um usuário excluído mantinha acesso
 * pelos 15 min de validade do access token (AUDITORIA.md#PEND-07). Com 30s de
 * cache, a janela cai de 15 minutos para meio minuto ao custo de ~2 consultas
 * por minuto por usuário ativo.
 */
const VALIDITY_TTL_MS = 30_000;
const g = globalThis as unknown as {
  __sg_valid?: Map<string, { until: number; ok: boolean }>;
};
g.__sg_valid ||= new Map();

async function accountStillValid(userId: string, iat?: number): Promise<boolean> {
  const now = Date.now();
  const hit = g.__sg_valid!.get(userId);
  if (hit && hit.until > now) return hit.ok;

  const { findById } = await import("@/lib/repos/users");
  const fresh = await findById(userId).catch(() => undefined); // já filtra deletedAt
  // Corte de sessão (troca de papel/senha) invalida tokens antigos — mesma
  // regra do refresh, em segundos para casar com a precisão do `iat`.
  const cutoff = fresh?.sessionsInvalidatedAt
    ? Math.floor(fresh.sessionsInvalidatedAt.getTime() / 1000)
    : 0;
  const ok = !!fresh && (!iat || !cutoff || iat >= cutoff);

  g.__sg_valid!.set(userId, { until: now + VALIDITY_TTL_MS, ok });
  if (g.__sg_valid!.size > 5000) {
    for (const [k, v] of g.__sg_valid!) if (v.until <= now) g.__sg_valid!.delete(k);
  }
  return ok;
}

/** Lê a sessão; retorna claims ou null. Middleware já barra, isto é defesa extra. */
export async function requireSession(
  req: NextRequest
): Promise<SessionClaims | null> {
  const s = await getSession(req);
  if (!s) return null;
  const iat = (s as SessionClaims & { iat?: number }).iat;
  return (await accountStillValid(s.sub, iat)) ? s : null;
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
