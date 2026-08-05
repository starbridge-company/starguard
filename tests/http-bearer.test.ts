// ============================================================
// Bearer e CSRF — AUDITORIA.md#SEC-10.
//
// `requireSession` e `requireCsrf` são o ponto por onde TODA requisição
// autenticada do app passa: cerca de vinte rotas. Aceitar Bearer ali é a
// mudança de maior alcance desta entrega, e a que mais precisa de teste antes
// de qualquer rota mudar de comportamento.
//
// A regra sob teste é uma só, e é sutil: **CSRF se aplica a credencial de
// cookie, não a credencial de header** — porque CSRF existe pelo fato de o
// navegador enviar o cookie sozinho, e nenhum navegador acrescenta um
// `Authorization` espontaneamente.
//
// O caminho negativo que mais importa é o do BEARER INVÁLIDO junto de um
// cookie válido: se a autenticação caísse para o cookie nesse caso, bastaria
// acrescentar um header lixo para pular a checagem de CSRF.
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const verificar = vi.hoisted(() => vi.fn());
const sessaoCookie = vi.hoisted(() => vi.fn());
const csrfCookie = vi.hoisted(() => vi.fn(() => true));
const familiaAtiva = vi.hoisted(() => vi.fn(async () => true));
const contaValida = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/jwt", () => ({ verifyToken: verificar }));
vi.mock("@/lib/oauth/sessions", () => ({ familyIsActive: familiaAtiva }));
vi.mock("@/lib/auth", () => ({
  getSession: sessaoCookie,
  checkCsrf: csrfCookie,
}));
vi.mock("@/lib/repos/users", () => ({
  findById: async () => (await contaValida()) ? { id: "u-1", sessionsInvalidatedAt: null } : undefined,
}));

const { requireSession, requireCsrf, credentialSource } = await import("@/lib/http");

const CLAIMS_CLIENTE = {
  sub: "u-1",
  email: "a@b.c",
  role: "admin",
  type: "access" as const,
  fam: "f-1",
  cid: "starguard-cli",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
};

const CLAIMS_WEB = { ...CLAIMS_CLIENTE, fam: undefined, cid: undefined };

/** Requisição mínima: o que `requireSession`/`requireCsrf` de fato leem. */
function req(opts: { bearer?: string; cookie?: boolean } = {}): NextRequest {
  const headers = new Headers();
  if (opts.bearer !== undefined) headers.set("authorization", opts.bearer);
  return {
    headers,
    cookies: { get: () => (opts.cookie ? { value: "cookie-token" } : undefined) },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  csrfCookie.mockReturnValue(true);
  familiaAtiva.mockResolvedValue(true);
  contaValida.mockResolvedValue(true);
  sessaoCookie.mockResolvedValue(CLAIMS_WEB);
  verificar.mockResolvedValue(CLAIMS_CLIENTE);
  // `accountStillValid` memoriza a validade da conta por 30 s num mapa em
  // `globalThis` — é a troca deliberada do SEC-02 (conta excluída mantém
  // acesso por ~30 s em vez de 15 min). Entre testes, esse cache faria um caso
  // herdar a resposta do anterior.
  (globalThis as unknown as { __sg_valid?: Map<string, unknown> }).__sg_valid?.clear();
});

describe("credentialSource", () => {
  it("distingue header de cookie", () => {
    expect(credentialSource(req({ bearer: "Bearer abc" }))).toBe("bearer");
    expect(credentialSource(req({ cookie: true }))).toBe("cookie");
  });

  it("aceita a grafia do esquema em qualquer caixa", () => {
    expect(credentialSource(req({ bearer: "bearer abc" }))).toBe("bearer");
    expect(credentialSource(req({ bearer: "BEARER abc" }))).toBe("bearer");
  });

  it("outro esquema de autorização não é Bearer", () => {
    expect(credentialSource(req({ bearer: "Basic dXNlcjpwYXNz" }))).toBe("cookie");
  });
});

describe("requireSession com Bearer", () => {
  it("aceita um access token de cliente válido", async () => {
    const s = await requireSession(req({ bearer: "Bearer bom" }));
    expect(s?.sub).toBe("u-1");
    // O público pedido é `client`: um cookie roubado não vale aqui.
    expect(verificar).toHaveBeenCalledWith("bom", "client");
  });

  it("RECUSA quando a assinatura/público não confere", async () => {
    verificar.mockResolvedValue(null);
    expect(await requireSession(req({ bearer: "Bearer ruim" }))).toBeNull();
  });

  it("RECUSA um refresh token apresentado como access", async () => {
    // O refresh dura 30 dias; aceitá-lo como credencial de requisição seria
    // dar a ele o alcance que só o access de 15 min deveria ter.
    verificar.mockResolvedValue({ ...CLAIMS_CLIENTE, type: "refresh" });
    expect(await requireSession(req({ bearer: "Bearer refresh" }))).toBeNull();
  });

  it("RECUSA quando a sessão do dispositivo foi revogada", async () => {
    // É o que fecha a janela de 15 minutos: sem esta checagem, revogar um
    // dispositivo o deixaria trabalhando até o token expirar sozinho.
    familiaAtiva.mockResolvedValue(false);
    expect(await requireSession(req({ bearer: "Bearer bom" }))).toBeNull();
  });

  it("RECUSA quando a conta não existe mais", async () => {
    contaValida.mockResolvedValue(false);
    expect(await requireSession(req({ bearer: "Bearer bom" }))).toBeNull();
  });

  it("NÃO cai para o cookie quando o Bearer falha", async () => {
    // O ponto mais importante deste arquivo. `requireCsrf` dispensa a checagem
    // quando há header `Authorization`; se a autenticação caísse para o cookie
    // aqui, bastaria mandar um Bearer lixo junto do cookie para autenticar SEM
    // CSRF.
    verificar.mockResolvedValue(null);
    sessaoCookie.mockResolvedValue(CLAIMS_WEB);

    expect(await requireSession(req({ bearer: "Bearer lixo", cookie: true }))).toBeNull();
    expect(sessaoCookie).not.toHaveBeenCalled();
  });

  it("sem header nenhum, usa o cookie como sempre", async () => {
    const s = await requireSession(req({ cookie: true }));
    expect(s?.sub).toBe("u-1");
    expect(sessaoCookie).toHaveBeenCalled();
    expect(verificar).not.toHaveBeenCalled();
  });
});

describe("requireCsrf — a regra pela ORIGEM da credencial", () => {
  it("cookie EXIGE CSRF", async () => {
    csrfCookie.mockReturnValue(false);
    expect(requireCsrf(req({ cookie: true }))).toBe(false);

    csrfCookie.mockReturnValue(true);
    expect(requireCsrf(req({ cookie: true }))).toBe(true);
  });

  it("Bearer DISPENSA CSRF", async () => {
    // Nenhum navegador acrescenta `Authorization` sozinho: quem o envia teve de
    // possuir o token e escrevê-lo. Exigir CSRF aqui seria atrito sem defesa.
    csrfCookie.mockReturnValue(false);
    expect(requireCsrf(req({ bearer: "Bearer bom" }))).toBe(true);
  });

  it("a dispensa vem do REQUEST, não de escolha do cliente", () => {
    // Não há flag no corpo, no header ou na query que ligue a dispensa. A
    // única coisa que a produz é a presença de `Authorization` — e essa
    // presença é justamente o que faz `requireSession` parar de olhar o
    // cookie. As duas funções lêem o mesmo sinal, e é isso que impede combinar
    // "dispensa o CSRF" com "autentica pelo cookie".
    const comHeader = req({ bearer: "Bearer x", cookie: true });
    expect(credentialSource(comHeader)).toBe("bearer");
    expect(requireCsrf(comHeader)).toBe(true);
  });

  it("header vazio ou malformado NÃO dispensa CSRF", () => {
    csrfCookie.mockReturnValue(false);
    // "Bearer" sem valor não é credencial: cai no caminho do cookie, onde o
    // CSRF volta a valer.
    expect(requireCsrf(req({ bearer: "Bearer" }))).toBe(false);
    expect(requireCsrf(req({ bearer: "Bearer   " }))).toBe(false);
    expect(requireCsrf(req({ bearer: "" }))).toBe(false);
  });
});
