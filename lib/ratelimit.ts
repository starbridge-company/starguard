// ============================================================
// Rate limiting com dois backends:
//
//   memória  (padrão)  — instância única; simples e sem dependência.
//   Redis    (opcional) — via API REST do Upstash, quando RATE_LIMIT_REDIS_URL
//                         e RATE_LIMIT_REDIS_TOKEN estão definidos.
//
// Com mais de uma instância, o balde em memória vive por processo: o limite
// efetivo multiplica pelo número de instâncias e fica imprevisível.
// Ver AUDITORIA.md#SEC-08 e #PEND-01.
//
// Escolha do protocolo REST em vez de um cliente TCP: funciona no runtime EDGE
// (onde o middleware roda) e não acrescenta dependência a um produto de
// segurança. Janela fixa por chave, igual nos dois backends.
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

// ------------------------------------------------------------
// Backend Redis (opcional)
// ------------------------------------------------------------
const REDIS_URL = process.env.RATE_LIMIT_REDIS_URL?.replace(/\/+$/, "");
const REDIS_TOKEN = process.env.RATE_LIMIT_REDIS_TOKEN;
const useRedis = !!REDIS_URL && !!REDIS_TOKEN;

/**
 * Executa comandos no Redis via REST. Devolve null em qualquer falha — o
 * chamador então usa a memória. Um limitador fora do ar NÃO pode derrubar o
 * login: preferimos degradar para o balde local a trancar todo mundo fora.
 */
async function redisPipeline(cmds: unknown[][]): Promise<unknown[] | null> {
  if (!useRedis) return null;
  try {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${REDIS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: unknown; error?: string }[];
    if (!Array.isArray(data)) return null;
    return data.map((d) => d.result);
  } catch {
    return null;
  }
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

function memConsume(key: string, spec: RateSpec): RateResult {
  const now = Date.now();
  maybeSweep(now);
  const store = g.__sg_rl!;
  let b = store.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + spec.windowMs };
    store.set(key, b);
  }
  b.count += 1;
  return {
    allowed: b.count <= spec.max,
    remaining: Math.max(0, spec.max - b.count),
    resetMs: b.resetAt - now,
    limit: spec.max,
  };
}

function memPeek(key: string, spec: RateSpec): RateResult {
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

/** Consome uma unidade da cota da chave. */
export async function rateLimit(key: string, spec: RateSpec): Promise<RateResult> {
  const segundos = Math.ceil(spec.windowMs / 1000);
  // INCR + EXPIRE NX: o TTL é definido só na primeira ocorrência da janela,
  // então a janela é fixa (não desliza a cada requisição).
  const r = await redisPipeline([
    ["INCR", key],
    ["EXPIRE", key, segundos, "NX"],
    ["PTTL", key],
  ]);
  if (!r) return memConsume(key, spec);

  const count = Number(r[0] ?? 0);
  const pttl = Number(r[2] ?? spec.windowMs);
  return {
    allowed: count <= spec.max,
    remaining: Math.max(0, spec.max - count),
    resetMs: pttl > 0 ? pttl : spec.windowMs,
    limit: spec.max,
  };
}

/**
 * Consulta a cota SEM consumir. Use antes de uma operação que só deve gastar
 * cota quando falha (ex.: login) — assim uma tentativa bem-sucedida não conta.
 */
export async function peekRateLimit(
  key: string,
  spec: RateSpec
): Promise<RateResult> {
  const r = await redisPipeline([
    ["GET", key],
    ["PTTL", key],
  ]);
  if (!r) return memPeek(key, spec);

  const count = Number(r[0] ?? 0);
  const pttl = Number(r[1] ?? 0);
  return {
    allowed: count < spec.max,
    remaining: Math.max(0, spec.max - count),
    resetMs: pttl > 0 ? pttl : 0,
    limit: spec.max,
  };
}

/** Zera a cota da chave — chamado quando a tentativa dá certo. */
export async function resetRateLimit(key: string): Promise<void> {
  const r = await redisPipeline([["DEL", key]]);
  if (!r) g.__sg_rl!.delete(key);
}

/** Qual backend está ativo (diagnóstico e teste). */
export function rateLimitBackend(): "redis" | "memory" {
  return useRedis ? "redis" : "memory";
}

/**
 * IP real do cliente. NUNCA usar a entrada mais à esquerda do X-Forwarded-For:
 * ela é fornecida pelo cliente, o que permitiria (a) burlar o rate limit
 * trocando o valor a cada tentativa e (b) trancar outra pessoa fora do sistema
 * enchendo o balde dela. Proxies confiáveis ACRESCENTAM o IP real à direita —
 * por isso contamos a partir do fim.
 *
 * TRUSTED_PROXY_HOPS = quantos proxies confiáveis existem à frente da app.
 * nginx sozinho = 1; nginx + Cloudflare = 2. 0 desliga a leitura do
 * X-Forwarded-For. Ver DEPLOY.md.
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
