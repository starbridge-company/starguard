import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class InfraUnavailable extends Error {
    constructor(
      message: string,
      public cause?: unknown,
      public kind: "schema" | "database" = "database"
    ) {
      super(message);
      this.name = "InfraUnavailable";
    }
  }
  return {
    InfraUnavailable,
    authenticate: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  InfraUnavailable: mocks.InfraUnavailable,
  authenticate: mocks.authenticate,
  issueSession: vi.fn(),
  setSessionCookies: vi.fn(),
  audit: vi.fn(),
  hashIp: vi.fn(() => "ip"),
}));

vi.mock("@/lib/ratelimit", () => ({
  peekRateLimit: vi.fn(async () => ({ allowed: true, resetMs: 0 })),
  rateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  clientIp: vi.fn(() => "127.0.0.1"),
}));

const { POST } = await import("@/app/api/auth/login/route");

function request() {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@starguard.local", password: "senha-valida" }),
  }) as Parameters<typeof POST>[0];
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/auth/login · infraestrutura não é sempre migration", () => {
  it("banco inalcançável recebe chave própria, não o falso alerta de migration", async () => {
    mocks.authenticate.mockRejectedValue(
      new mocks.InfraUnavailable(
        "Não foi possível verificar o schema: timeout",
        undefined,
        "database"
      )
    );

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.errorKey).toBe("err.databaseUnavailable");
  });

  it("schema realmente atrasado continua pedindo migration", async () => {
    mocks.authenticate.mockRejectedValue(
      new mocks.InfraUnavailable("Banco desatualizado", undefined, "schema")
    );

    const body = await (await POST(request())).json();
    expect(body.errorKey).toBe("err.schemaOutdated");
  });
});
