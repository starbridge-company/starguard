"use client";

// Cliente HTTP do frontend — injeta o token CSRF (double-submit) nas
// requisições que mudam estado, RENOVA a sessão automaticamente quando o
// access token expira e trata erros de forma uniforme.

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : undefined;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Chave estável para tradução (AUDITORIA.md#PEND-17). */
    public key?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** true quando a falha foi um cancelamento nosso (AbortController), não um erro. */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** Chave genérica por status, para respostas sem corpo JSON (proxy, 502 do
 *  host, timeout). Sem ela a tela mostraria um texto fixo em português. */
function keyForStatus(status: number): string {
  if (status === 401) return "err.unauthenticated";
  if (status === 403) return "err.forbidden";
  if (status === 404) return "err.notFound";
  if (status === 409) return "err.conflict";
  if (status === 429) return "err.tooManyRequests";
  if (status >= 500) return "err.server";
  return "err.badRequest";
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: string; errorKey?: string };
    const key = body?.errorKey ?? (body?.error ? undefined : keyForStatus(res.status));
    throw new ApiError(body?.error || "", res.status, key);
  }
  return data as T;
}

// ------------------------------------------------------------
// Renovação de sessão
//
// O access token dura 15 min; o refresh, 7 dias. Antes disto NADA chamava
// /api/auth/refresh: a cada 15 minutos o usuário era expulso para o login no
// meio do trabalho — e cada relogin consumia a cota de rate limit até travar
// tudo por 15 min. Ver AUDITORIA.md#BUG-01.
//
// `inflight` garante UMA renovação por vez: com 5 requisições falhando em 401
// ao mesmo tempo, todas esperam o mesmo refresh em vez de dispararem 5.
// ------------------------------------------------------------
let inflight: Promise<boolean> | null = null;
let lastRefreshAt = 0;

export function refreshSession(): Promise<boolean> {
  if (!inflight) {
    inflight = fetch("/api/auth/refresh", {
      method: "POST",
      headers: { accept: "application/json" },
    })
      .then((r) => {
        if (r.ok) lastRefreshAt = Date.now();
        return r.ok;
      })
      .catch(() => false)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Renova só se já faz um tempo — usado pelo keepalive e ao focar a aba. */
export function refreshIfStale(maxAgeMs: number): Promise<boolean> {
  if (Date.now() - lastRefreshAt < maxAgeMs) return Promise.resolve(true);
  return refreshSession();
}

function goToLogin(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (pathname === "/login") return;
  window.location.href = `/login?next=${encodeURIComponent(pathname + search)}`;
}

// ------------------------------------------------------------
// Requisição
// ------------------------------------------------------------
export interface RequestOptions {
  signal?: AbortSignal;
}

interface InternalOptions extends RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(
  url: string,
  opts: InternalOptions = {},
  allowRefresh = true
): Promise<T> {
  const method = opts.method || "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    // Lido A CADA tentativa: o refresh ROTACIONA o cookie de CSRF, então um
    // valor capturado antes da renovação já estaria velho no retry.
    const csrf = getCookie("sg_csrf");
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  // 401 = access token expirado. Renova uma vez e repete a requisição
  // original. `allowRefresh=false` no retry evita laço infinito.
  if (res.status === 401 && allowRefresh && !url.startsWith("/api/auth/")) {
    if (await refreshSession()) {
      return request<T>(url, opts, false);
    }
    goToLogin();
  }

  return handle<T>(res);
}

export function apiGet<T>(url: string, opts?: RequestOptions): Promise<T> {
  return request<T>(url, { ...opts });
}

export function apiPost<T>(
  url: string,
  body?: unknown,
  opts?: RequestOptions
): Promise<T> {
  return request<T>(url, { method: "POST", body, ...opts });
}

export function apiPatch<T>(
  url: string,
  body?: unknown,
  opts?: RequestOptions
): Promise<T> {
  return request<T>(url, { method: "PATCH", body, ...opts });
}

export function apiDelete<T>(url: string, opts?: RequestOptions): Promise<T> {
  return request<T>(url, { method: "DELETE", ...opts });
}
