import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, peekRateLimit, resetRateLimit, clientIp } from "@/lib/ratelimit";

const SPEC = { max: 3, windowMs: 60_000 };

function limpar() {
  const g = globalThis as unknown as { __sg_rl?: Map<string, unknown> };
  g.__sg_rl?.clear();
}

// AUDITORIA.md#BUG-02 — o balde era cobrado no middleware E na rota, e login
// bem-sucedido também gastava cota: 5 logins corretos travavam a conta por
// 15 minutos.
describe("rateLimit · BUG-02", () => {
  beforeEach(limpar);

  it("peek NÃO consome cota", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await peekRateLimit("k", SPEC)).allowed).toBe(true);
    }
  });

  it("só o consumo explícito gasta, e bloqueia no limite", async () => {
    expect((await rateLimit("k", SPEC)).allowed).toBe(true);
    expect((await rateLimit("k", SPEC)).allowed).toBe(true);
    expect((await rateLimit("k", SPEC)).allowed).toBe(true);
    expect((await rateLimit("k", SPEC)).allowed).toBe(false);
  });

  it("reset zera o histórico de falhas (login que dá certo)", async () => {
    await rateLimit("k", SPEC);
    await rateLimit("k", SPEC);
    await resetRateLimit("k");
    expect((await peekRateLimit("k", SPEC)).remaining).toBe(SPEC.max);
  });

  it("baldes de chaves diferentes não se misturam", async () => {
    await rateLimit("a", SPEC);
    await rateLimit("a", SPEC);
    await rateLimit("a", SPEC);
    expect((await rateLimit("a", SPEC)).allowed).toBe(false);
    expect((await rateLimit("b", SPEC)).allowed).toBe(true);
  });
});

// AUDITORIA.md#SEC-04 — pegar a entrada mais à ESQUERDA do X-Forwarded-For
// permitia burlar o limite (valor novo a cada tentativa) e trancar outra
// pessoa fora do sistema enchendo o balde dela.
describe("clientIp · SEC-04", () => {
  const h = (v: Record<string, string>) => new Headers(v);

  it("ignora o valor forjado pelo cliente e usa o que o proxy acrescentou", () => {
    // TRUSTED_PROXY_HOPS=1 (padrão): o proxy confiável escreve por último.
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
  });

  it("sem proxy à frente, usa a única entrada existente", () => {
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("cai para x-real-ip e depois para localhost", () => {
    expect(clientIp(h({ "x-real-ip": "10.0.0.5" }))).toBe("10.0.0.5");
    expect(clientIp(h({}))).toBe("127.0.0.1");
  });
});
