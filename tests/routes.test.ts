import { describe, it, expect, vi, beforeEach } from "vitest";

// AUDITORIA.md#PEND-21 — as rotas dependiam de Postgres para serem testadas.
// Mockando só a camada de repositório, os handlers passam a ter cobertura de
// autorização e validação, que é onde mora o risco.

const sessao = vi.fn();
const csrf = vi.fn(() => true);
const acesso = vi.fn(() => true);

vi.mock("@/lib/http", async () => {
  const real = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return {
    ...real,
    requireSession: () => sessao(),
    requireCsrf: () => csrf(),
    canAccess: (...a: unknown[]) => acesso(...(a as [])),
  };
});

const findingsRepo = {
  getById: vi.fn(),
  ownerOfFinding: vi.fn(),
  setStatus: vi.fn(),
  listForAnalysis: vi.fn(async () => []),
  getLatestFix: vi.fn(),
  saveFix: vi.fn(),
};
vi.mock("@/lib/repos/findings", () => findingsRepo);
vi.mock("@/lib/auth", async () => {
  const real = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...real, audit: vi.fn() };
});

const { PATCH } = await import("@/app/api/findings/[id]/route");

const ID_VALIDO = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function req(body: unknown) {
  return {
    json: async () => body,
    cookies: { get: () => undefined },
    headers: new Headers(),
  } as unknown as Parameters<typeof PATCH>[0];
}
const params = (id = ID_VALIDO) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  // Sem isto, a contagem de chamadas acumula entre os testes e as asserções
  // de "não deve consultar o banco" passam a medir o teste anterior.
  vi.clearAllMocks();
  sessao.mockResolvedValue({ sub: "user-1", role: "admin", email: "a@b.c", type: "access" });
  csrf.mockReturnValue(true);
  acesso.mockReturnValue(true);
  findingsRepo.ownerOfFinding.mockResolvedValue("user-1");
  findingsRepo.setStatus.mockResolvedValue(undefined);
});

describe("PATCH /api/findings/[id] · FEAT-01", () => {
  it("dono muda o estado com sucesso", async () => {
    const res = await PATCH(req({ status: "fixed" }), params());
    expect(res.status).toBe(200);
    expect(findingsRepo.setStatus).toHaveBeenCalledWith(
      ID_VALIDO,
      "fixed",
      "user-1",
      undefined
    );
  });

  it("sem sessão -> 401", async () => {
    sessao.mockResolvedValue(null);
    expect((await PATCH(req({ status: "fixed" }), params())).status).toBe(401);
  });

  it("sem CSRF -> 403", async () => {
    csrf.mockReturnValue(false);
    expect((await PATCH(req({ status: "fixed" }), params())).status).toBe(403);
  });

  it("achado de OUTRO usuário -> 404 (não revela existência)", async () => {
    acesso.mockReturnValue(false);
    const res = await PATCH(req({ status: "fixed" }), params());
    expect(res.status).toBe(404);
    expect(findingsRepo.setStatus).not.toHaveBeenCalled();
  });

  it("achado inexistente -> 404", async () => {
    findingsRepo.ownerOfFinding.mockResolvedValue(undefined);
    expect((await PATCH(req({ status: "fixed" }), params())).status).toBe(404);
  });

  it("id malformado -> 404, sem consultar o banco", async () => {
    const res = await PATCH(req({ status: "fixed" }), params("nao-e-uuid"));
    expect(res.status).toBe(404);
    expect(findingsRepo.ownerOfFinding).not.toHaveBeenCalled();
  });

  it("estado inválido -> 400", async () => {
    expect((await PATCH(req({ status: "inventado" }), params())).status).toBe(400);
  });

  it("body vazio -> 400", async () => {
    expect((await PATCH(req(null), params())).status).toBe(400);
  });

  it("resposta de erro carrega chave de tradução (PEND-17)", async () => {
    sessao.mockResolvedValue(null);
    const body = await (await PATCH(req({ status: "fixed" }), params())).json();
    expect(body.errorKey).toBe("err.unauthenticated");
  });
});
