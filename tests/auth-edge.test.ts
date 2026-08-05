// ============================================================
// A decisão de acesso do middleware — AUDITORIA.md#SEC-15.
//
// Este arquivo existe por causa de um bug que a suíte verde escondia.
//
// `tests/http-bearer.test.ts` cobria o suporte a `Authorization: Bearer` do
// `requireSession`, e passava. Só que o middleware roda ANTES de qualquer
// rota, é default-deny, e lia apenas o cookie: nenhuma requisição da extensão
// chegava ao código testado. A cobertura era real e inútil ao mesmo tempo —
// testar a camada errada é pior que não testar, porque a suíte afirma que
// está coberto.
//
// O que se fixa aqui é o CAMINHO NEGATIVO da borda: o que entra, o que não
// entra, e — a parte que mais importa — o que um token de ferramenta não pode
// alcançar mesmo pertencendo a um superadmin.
// ============================================================
import { describe, it, expect } from "vitest";
import { credencialDoPedido, decidirAcesso } from "@/lib/auth-edge";

const ADMIN = "superadmin";
const acesso = (role = "admin") => ({ type: "access", role, sub: "u1" });

describe("de onde veio a credencial", () => {
  it("o header tem precedência sobre o cookie", () => {
    const c = credencialDoPedido("Bearer abc", "cookie-token");
    expect(c).toEqual({ origem: "bearer", token: "abc" });
  });

  it("sem header, vale o cookie", () => {
    expect(credencialDoPedido(null, "cookie-token")).toEqual({
      origem: "cookie",
      token: "cookie-token",
    });
  });

  it("`Bearer` é case-insensitive — clientes escrevem de tudo", () => {
    expect(credencialDoPedido("bearer abc", null)?.origem).toBe("bearer");
    expect(credencialDoPedido("BEARER abc", null)?.origem).toBe("bearer");
  });

  it("um header vazio ou malformado NÃO vira credencial de header", () => {
    // Se virasse, `decidirAcesso` recusaria por token inválido — mas o
    // importante é não classificar como bearer o que não é.
    expect(credencialDoPedido("Bearer", "c")?.origem).toBe("cookie");
    expect(credencialDoPedido("Basic abc", "c")?.origem).toBe("cookie");
    expect(credencialDoPedido("", "c")?.origem).toBe("cookie");
  });

  it("sem nenhum dos dois, não há credencial", () => {
    expect(credencialDoPedido(null, undefined)).toBeNull();
    expect(credencialDoPedido("", "")).toBeNull();
  });

  it("um Bearer presente NÃO cai para o cookie", () => {
    // O ponto todo: se caísse, bastaria mandar `Authorization: Bearer lixo`
    // para autenticar pelo cookie SEM passar por CSRF.
    const c = credencialDoPedido("Bearer lixo", "cookie-valido");
    expect(c?.origem).toBe("bearer");
    expect(c?.token).toBe("lixo");
  });
});

describe("quem entra", () => {
  it("cookie válido entra", () => {
    expect(
      decidirAcesso({
        origem: "cookie",
        claims: acesso(),
        areaAdmin: false,
        papelDeAdmin: ADMIN,
      })
    ).toEqual({ acao: "permitir", sub: "u1" });
  });

  it("**Bearer válido entra** — era exatamente isto que faltava", () => {
    // Sem esta linha passando, a extensão do VS Code e o CLI não funcionam:
    // o login conclui, o token é emitido, e a primeira chamada leva 401.
    expect(
      decidirAcesso({
        origem: "bearer",
        claims: acesso(),
        areaAdmin: false,
        papelDeAdmin: ADMIN,
      })
    ).toEqual({ acao: "permitir", sub: "u1" });
  });

  it("sem credencial, não entra", () => {
    expect(
      decidirAcesso({ origem: null, claims: null, areaAdmin: false, papelDeAdmin: ADMIN })
    ).toEqual({ acao: "recusar", motivo: "sem_credencial" });
  });
});

describe("o que a borda recusa", () => {
  it("refresh apresentado como acesso", () => {
    expect(
      decidirAcesso({
        origem: "bearer",
        claims: { type: "refresh", role: "admin", sub: "u1" },
        areaAdmin: false,
        papelDeAdmin: ADMIN,
      })
    ).toEqual({ acao: "recusar", motivo: "sem_credencial" });
  });

  it("token de acesso SEM papel", () => {
    // Papel ausente significa claims incompletas — não se presume nenhum.
    expect(
      decidirAcesso({
        origem: "cookie",
        claims: { type: "access", sub: "u1" },
        areaAdmin: false,
        papelDeAdmin: ADMIN,
      })
    ).toEqual({ acao: "recusar", motivo: "sem_credencial" });
  });

  it("claims nulas com origem presente — assinatura inválida", () => {
    expect(
      decidirAcesso({ origem: "bearer", claims: null, areaAdmin: false, papelDeAdmin: ADMIN })
    ).toEqual({ acao: "recusar", motivo: "sem_credencial" });
  });
});

describe("a área de governança não aceita credencial de ferramenta", () => {
  it("Bearer de SUPERADMIN é recusado no /admin", () => {
    // A regra que não é óbvia e que sustenta o resto: o papel diz o que a
    // PESSOA pode; o público do token diz o que aquele CLIENTE foi autorizado
    // a fazer em nome dela. A extensão pediu para analisar código e propor
    // correção — administrar a plataforma não estava entre os escopos.
    expect(
      decidirAcesso({
        origem: "bearer",
        claims: acesso(ADMIN),
        areaAdmin: true,
        papelDeAdmin: ADMIN,
      })
    ).toEqual({ acao: "recusar", motivo: "proibido" });
  });

  it("cookie de superadmin entra", () => {
    expect(
      decidirAcesso({
        origem: "cookie",
        claims: acesso(ADMIN),
        areaAdmin: true,
        papelDeAdmin: ADMIN,
      })
    ).toEqual({ acao: "permitir", sub: "u1" });
  });

  it("cookie de quem não é superadmin é recusado", () => {
    expect(
      decidirAcesso({
        origem: "cookie",
        claims: acesso("admin"),
        areaAdmin: true,
        papelDeAdmin: ADMIN,
      })
    ).toEqual({ acao: "recusar", motivo: "proibido" });
  });

  it("Bearer entra normalmente FORA da área de governança", () => {
    expect(
      decidirAcesso({
        origem: "bearer",
        claims: acesso(ADMIN),
        areaAdmin: false,
        papelDeAdmin: ADMIN,
      }).acao
    ).toBe("permitir");
  });
});
