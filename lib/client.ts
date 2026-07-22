"use client";

// Cliente HTTP do frontend — injeta o token CSRF (double-submit) nas
// requisições que mudam estado e trata erros de forma uniforme.

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
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as { error?: string })?.error || "Erro na requisição.", res.status);
  }
  return data as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return handle<T>(res);
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const csrf = getCookie("sg_csrf");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const csrf = getCookie("sg_csrf");
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiDelete<T>(url: string): Promise<T> {
  const csrf = getCookie("sg_csrf");
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      accept: "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
  });
  return handle<T>(res);
}
