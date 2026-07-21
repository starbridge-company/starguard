// ============================================================
// Rate limiting em memória (MVP). Em produção: trocar por Redis/Upstash
// (RATE_LIMIT_REDIS_URL) mantendo a mesma assinatura.
// Janela fixa por chave (conta+IP nos endpoints de auth; IP no global).
// ============================================================
import type { RateSpec } from "@/lib/config";

interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __sg_rl?: Map<string, Bucket> };
g.__sg_rl ||= new Map();

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limit: number;
}

export function rateLimit(key: string, spec: RateSpec): RateResult {
  const now = Date.now();
  const store = g.__sg_rl!;
  let b = store.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + spec.windowMs };
    store.set(key, b);
  }
  b.count += 1;
  const allowed = b.count <= spec.max;
  return {
    allowed,
    remaining: Math.max(0, spec.max - b.count),
    resetMs: b.resetAt - now,
    limit: spec.max,
  };
}

/** Melhor esforço para obter o IP real do cliente (respeitando proxy). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return (
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "127.0.0.1"
  );
}
