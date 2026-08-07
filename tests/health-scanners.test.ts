// ============================================================
// O health check não pode dizer "ok" sobre o que não conferiu.
//
// Medido contra a produção (`starguard-31l1.onrender.com`, meia CPU), na
// primeira requisição depois de a instância acordar:
//
//   {"status":"ok", …, "scanners":[], "scan":{"slots":1,…}}
//
// Luz verde com ZERO conhecimento sobre os scanners. A causa é o prazo de 8 s
// da rota: `checkBinaries()` não respondeu a tempo e o valor de fallback era
// `[]` — que é indistinguível de "conferi e não há nada a relatar". A segunda
// requisição, com o cache quente, mostrava os dois presentes.
//
// Por que isso importa mais do que parece: esta rota é a ÚNICA fonte de verdade
// sobre o estado do servidor, é o que o `starguard doctor` consulta e é o que
// um orquestrador usa para decidir se manda tráfego. E o momento em que ela
// erra é exatamente o momento em que alguém a consulta — quando desconfia que
// algo está errado. Um verde que às vezes significa "não olhei" não serve para
// decidir nada.
//
// Ver AUDITORIA.md#BUG-26.
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const checkBinaries = vi.fn();
vi.mock("@starguard/core/binaries", () => ({ checkBinaries: () => checkBinaries() }));

// O schema em dia tira o banco do caminho: o que se mede aqui é o veredito
// sobre os SCANNERS.
vi.mock("@/lib/schema-check", () => ({
  checkSchema: async () => ({ ok: true, expected: 9, applied: 9, pending: [] }),
  schemaMessage: () => "Schema em dia.",
  MIGRATE_HINT: "",
}));

vi.mock("@/lib/scan-jobs", () => ({
  jobsAtivos: () => 0,
  recolherAbandonados: () => {},
  totalDeJobs: () => 0,
}));

const { GET } = await import("@/app/api/health/route");

/** O prazo da rota é 8 s; um valor curto mantém a suíte honesta e rápida. */
beforeEach(() => {
  process.env.HEALTH_TIMEOUT_MS = "50";
  checkBinaries.mockReset();
});

async function corpo() {
  const res = await GET();
  return (await res.json()) as {
    status: string;
    scanners: unknown;
    scannersMessage?: string;
    scannersBusyMessage?: string;
  };
}

describe("sondagem que não respondeu a tempo", () => {
  it("NÃO diz «ok» — era o verde que a produção mostrava sem ter olhado", async () => {
    // Nunca resolve: é o caso real da instância fria.
    checkBinaries.mockImplementation(() => new Promise(() => {}));

    const b = await corpo();

    expect(b.status).toBe("degraded");
  });

  it("responde `null`, e não lista vazia — «não sei» é diferente de «nada a relatar»", async () => {
    checkBinaries.mockImplementation(() => new Promise(() => {}));

    expect((await corpo()).scanners).toBeNull();
  });

  it("diz que não deu para verificar, e que isso NÃO é ausência", async () => {
    checkBinaries.mockImplementation(() => new Promise(() => {}));

    const b = await corpo();

    expect(b.scannersMessage).toMatch(/não deu para verificar/i);
    // A frase precisa desarmar a conclusão errada: numa instância pequena, o
    // prazo estourar é esperado, e mandar alguém reinstalar o opengrep por
    // causa disso é o pior conselho que esta rota pode dar.
    expect(b.scannersMessage).toMatch(/não quer dizer que estão ausentes/i);
  });
});

describe("sondagem que respondeu", () => {
  it("os dois presentes = «ok»", async () => {
    checkBinaries.mockResolvedValue([
      { name: "sast", configured: "opengrep", required: true, present: true, version: "1.25.0" },
      { name: "sca", configured: "trivy", required: true, present: true, version: "0.72.0" },
    ]);

    expect((await corpo()).status).toBe("ok");
  });

  it("ausente de verdade = «degraded», com o binário nomeado", async () => {
    checkBinaries.mockResolvedValue([
      { name: "sast", configured: "opengrep", required: true, present: false, reason: "missing" },
      { name: "sca", configured: "trivy", required: true, present: true, version: "0.72.0" },
    ]);

    const b = await corpo();

    expect(b.status).toBe("degraded");
    expect(b.scannersMessage).toContain("opengrep");
  });

  it("«ocupado» NÃO derruba o status: o binário está lá e a análise usa", async () => {
    checkBinaries.mockResolvedValue([
      {
        name: "sast",
        configured: "opengrep",
        required: true,
        present: false,
        reason: "busy",
        detail: "sem resposta em 20000 ms",
      },
      { name: "sca", configured: "trivy", required: true, present: true, version: "0.72.0" },
    ]);

    const b = await corpo();

    // Máquina ocupada é estado passageiro, não defeito do ambiente. Marcar
    // `degraded` aqui faria um orquestrador tirar de serviço uma instância que
    // está apenas trabalhando.
    expect(b.status).toBe("ok");
    // Mas é DITO, em campo próprio: some do status, não da resposta.
    expect(b.scannersBusyMessage).toContain("opengrep");
    expect(b.scannersMessage).toBeUndefined();
  });
});
