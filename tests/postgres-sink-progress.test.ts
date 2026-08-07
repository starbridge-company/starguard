import { beforeEach, describe, expect, it, vi } from "vitest";

const patchAnalysis = vi.fn(async () => {});
vi.mock("@/lib/repos/analyses", () => ({ patchAnalysis }));
vi.mock("@/lib/repos/findings", () => ({ persistScanFindings: vi.fn(async () => 0) }));

const { postgresSink } = await import("@/lib/sinks/postgres");

beforeEach(() => patchAnalysis.mockClear());

describe("fase composta do painel", () => {
  it("continua running quando SAST termina mas SCA ainda está executando", async () => {
    const sink = postgresSink({
      analysisId: "a-1",
      userId: "u-1",
      locale: "pt-BR",
      selected: ["sast", "sca"],
    });

    await sink.on({ type: "analyzer:start", id: "sast", at: 1 });
    await sink.on({ type: "analyzer:start", id: "sca", at: 2 });
    await sink.on({
      type: "analyzer:done",
      id: "sast",
      at: 10,
      durationMs: 9,
      result: [],
      degraded: [],
    });

    expect(sink.phases.software.status).toBe("running");

    await sink.on({
      type: "analyzer:done",
      id: "sca",
      at: 20,
      durationMs: 18,
      result: [],
      degraded: [],
    });
    expect(sink.phases.software.status).toBe("done");
  });

  it("persiste a mensagem de fila/scan para o painel não parecer travado", async () => {
    const sink = postgresSink({
      analysisId: "a-2",
      userId: "u-1",
      locale: "pt-BR",
      selected: ["sast", "sca"],
    });
    await sink.on({ type: "analyzer:start", id: "sca", at: 1 });
    await sink.on({
      type: "analyzer:progress",
      id: "sca",
      message: "aguardando vaga de scanner (1º)",
    });

    expect(sink.phases.software.status).toBe("running");
    expect(sink.phases.software.message).toContain("aguardando vaga");
    expect(patchAnalysis).toHaveBeenCalled();
  });
});
