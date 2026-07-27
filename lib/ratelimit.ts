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

const g = globalThis as unknown as {
  __sg_rl?: Map<string, Bucket>;
  __sg_rl_sweep?: number;
};
g.__sg_rl ||= new Map();

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limit: number;
}

// Sem expurgo, o Map cresce para sempre (uma entrada por IP/conta já vista).
// Varre a cada 1000 chamadas — barato e suficiente para o volume do MVP.
const SWEEP_EVERY = 1000;
function maybeSweep(now: number): void {
  g.__sg_rl_sweep = (g.__sg_rl_sweep ?? 0) + 1;
  if (g.__sg_rl_sweep < SWEEP_EVERY) return;
  g.__sg_rl_sweep = 0;
  for (const [k, b] of g.__sg_rl!) {
    if (now > b.resetAt) g.__sg_rl!.delete(k);
  }
}

/** Consome uma unidade da cota da chave. */
export function rateLimit(key: string, spec: RateSpec): RateResult {
  const now = Date.now();
  maybeSweep(now);
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

/**
 * Consulta a cota SEM consumir. Use antes de uma operação que só deve gastar
 * cota quando falha (ex.: login) — assim uma tentativa bem-sucedida não conta.
 */
export function peekRateLimit(key: string, spec: RateSpec): RateResult {
  const now = Date.now();
  const b = g.__sg_rl!.get(key);
  if (!b || now > b.resetAt) {
    return { allowed: true, remaining: spec.max, resetMs: 0, limit: spec.max };
  }
  return {
    allowed: b.count < spec.max,
    remaining: Math.max(0, spec.max - b.count),
    resetMs: b.resetAt - now,
    limit: spec.max,
  };
}

/** Zera a cota da chave — chamado quando a tentativa dá certo. */
export function resetRateLimit(key: string): void {
  g.__sg_rl!.delete(key);
}

/**
 * IP real do cliente. NUNCA usar a entrada mais à esquerda do X-Forwarded-For:
 * ela é fornecida pelo cliente, o que permitiria (a) burlar o rate limit
 * trocando o valor a cada tentativa e (b) trancar outra pessoa fora do sistema
 * enchendo o balde dela. Proxies confiáveis ACRESCENTAM o IP real à direita —
 * por isso contamos a partir do fim.
 *
 * TRUSTED_PROXY_HOPS = quantos proxies confiáveis existem à frente da app
 * (Render/Vercel/Cloudflare = 1). 0 desliga a leitura do X-Forwarded-For.
 */
const TRUSTED_HOPS = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS ?? 1));

export function clientIp(headers: Headers): string {
  if (TRUSTED_HOPS > 0) {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      // hops=1 -> último; hops=2 -> penúltimo. Se vierem menos entradas que
      // hops, o cliente não injetou nada: a primeira é a real.
      const ip = parts[Math.max(0, parts.length - TRUSTED_HOPS)];
      if (ip) return ip;
    }
  }
  return headers.get("x-real-ip") || headers.get("cf-connecting-ip") || "127.0.0.1";
}
