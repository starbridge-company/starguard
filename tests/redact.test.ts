import { describe, it, expect } from "vitest";
import { redact, redactError } from "@starguard/core/redact";

// AUDITORIA.md#SEC-01 — a mensagem de erro do git repete a URL do remote, que
// carrega o PAT. Esse texto é PERSISTIDO no JSONB e exibido na tela.
describe("redact · SEC-01", () => {
  it("apaga o token da mensagem real do git", () => {
    const msg =
      "Command failed: git clone https://x-access-token:ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6@github.com/acme/privado.git /tmp/sg-scan-x\n" +
      "fatal: Authentication failed for 'https://x-access-token:ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6@github.com/acme/privado.git/'";
    const out = redact(msg);
    expect(out).not.toContain("ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6");
    expect(out).toContain("https://***@github.com/acme/privado.git");
  });

  it("apaga PAT fine-grained solto no texto", () => {
    const out = redact("token github_pat_11ABCDEFG0abcdefghijkl_1a2b3c4d5e6f7g8h9i0j inválido");
    expect(out).not.toMatch(/github_pat_\w{20}/);
  });

  it("apaga chaves de IA", () => {
    expect(redact("key=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv")).not.toContain("api03");
    expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).not.toContain(
      "eyJhbGciOiJIUzI1NiIs"
    );
  });

  it("apaga usuário e senha embutidos em URL", () => {
    expect(redact("https://nelson:s3nh4Secreta@github.com/acme/x.git")).not.toContain(
      "s3nh4Secreta"
    );
  });

  it("NÃO mexe em texto sem segredo", () => {
    const limpo = "fatal: repository 'https://github.com/acme/publico.git' not found";
    expect(redact(limpo)).toBe(limpo);
  });

  it("redactError aceita qualquer coisa sem lançar", () => {
    expect(redactError(new Error("Bearer abcdefghijklmnop"))).not.toContain("abcdefghijklmnop");
    expect(() => redactError(null)).not.toThrow();
    expect(() => redactError({ estranho: true })).not.toThrow();
  });
});
