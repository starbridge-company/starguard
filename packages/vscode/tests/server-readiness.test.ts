import { describe, expect, it, vi } from "vitest";
import { checkServerReadiness, classifyHealth } from "../src/server-readiness";

describe("prontidão antes do OAuth · banco/SAST em produção", () => {
  it("timeout do banco não é apresentado como migration pendente", () => {
    const r = classifyHealth(false, {
      db: "unreachable",
      schema: { ok: false, pending: [] },
      message: "Sem resposta do banco em 8000 ms.",
    });

    expect(r).toMatchObject({ ok: false, errorKey: "err.databaseUnavailable" });
    expect(r.errorKey).not.toBe("err.schemaOutdated");
  });

  it("migration comprovadamente pendente mantém a orientação correta", () => {
    expect(
      classifyHealth(false, {
        db: "ok",
        schema: { ok: false, pending: ["0008_jobs"] },
      }).errorKey
    ).toBe("err.schemaOutdated");
  });

  it("servidor pronto permite abrir o login", () => {
    expect(
      classifyHealth(true, { db: "ok", schema: { ok: true, pending: [] } })
    ).toEqual({ ok: true });
  });

  it("falha de rede termina com erro acionável em vez de esperar o OAuth", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await checkServerReadiness("https://starguard.invalid/", {
      fetchImpl,
      timeoutMs: 20,
    });

    expect(r).toMatchObject({ ok: false, errorKey: "err.network" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://starguard.invalid/api/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
