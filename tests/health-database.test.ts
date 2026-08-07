import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/schema-check", () => ({
  checkSchema: async () => ({
    ok: false,
    expected: 9,
    applied: null,
    pending: [],
    error: "Connection terminated due to connection timeout",
  }),
  schemaMessage: () =>
    "Não foi possível verificar o schema: Connection terminated due to connection timeout",
  MIGRATE_HINT: "npm run db:migrate",
  EXPECTED_MIGRATIONS: 9,
}));

vi.mock("@starguard/core/binaries", () => ({
  checkBinaries: async () => [
    { name: "sast", configured: "opengrep", required: true, present: true },
    { name: "sca", configured: "trivy", required: true, present: true },
  ],
}));

vi.mock("@/lib/scan-jobs", () => ({
  jobsAtivos: () => 0,
  recolherAbandonados: () => {},
  totalDeJobs: () => 0,
}));

const { GET } = await import("@/app/api/health/route");

describe("GET /api/health · banco inalcançável não é migration", () => {
  it("expõe a causa correta e não recomenda um comando incapaz de conectar", async () => {
    const res = await GET(new Request("http://localhost/api/health"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.db).toBe("unreachable");
    expect(body.schema.pending).toEqual([]);
    expect(body.schema.expected).toBe(9);
    expect(body.schema.applied).toBeNull();
    expect(body.hint).toBeUndefined();
    expect(body.message).toMatch(/timeout/i);
  });
});
