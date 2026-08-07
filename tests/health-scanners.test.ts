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
import { readFileSync } from "node:fs";
import { join } from "node:path";

const checkBinaries = vi.fn();
vi.mock("@starguard/core/binaries", () => ({ checkBinaries: () => checkBinaries() }));

// O schema em dia tira o banco do caminho: o que se mede aqui é o veredito
// sobre os SCANNERS.
vi.mock("@/lib/schema-check", () => ({
  checkSchema: async () => ({ ok: true, expected: 9, applied: 9, pending: [] }),
  schemaMessage: () => "Schema em dia.",
  MIGRATE_HINT: "",
  EXPECTED_MIGRATIONS: 9,
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
  // Sem `?probe=live`: é a PRONTIDÃO que se mede aqui. A vivacidade tem suíte
  // própria em `tests/health-vivacidade.test.ts`.
  const res = await GET(new Request("http://localhost/api/health"));
  return (await res.json()) as {
    status: string;
    scanners: unknown;
    scannersMessage?: string;
    scannersBusyMessage?: string;
    scan: {
      memory: {
        rssMb: number;
        heapUsedMb: number;
        heapTotalMb: number;
        externalMb: number;
        arrayBuffersMb: number;
      };
    };
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
  it("publica o uso de memória do processo para diagnosticar pressão real", async () => {
    checkBinaries.mockResolvedValue([]);
    const memory = (await corpo()).scan.memory;
    expect(memory.rssMb).toBeGreaterThan(0);
    expect(memory.heapUsedMb).toBeGreaterThan(0);
    expect(memory.heapTotalMb).toBeGreaterThanOrEqual(memory.heapUsedMb);
  });

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

// ============================================================
// O HEALTHCHECK do Dockerfile precisa esperar mais que a rota
// ============================================================
//
// Dois números acoplados que estavam invertidos: o `--timeout` do HEALTHCHECK
// era 5 s e o prazo interno da rota é 8 s. Com o banco pendurado, a rota espera
// os 8 s de propósito (para responder o que CONSEGUIU medir) — e o `curl` já
// tinha sido morto aos 5. A checagem não tinha como passar.
//
// No Coolify isso derrubou o deploy, com uma saída que não menciona banco:
//
//   Attempt 2 of 3 | Healthcheck logs: Health check exceeded timeout (5s)
//   New container is not healthy, rolling back to the old container.
//
// Nenhum teste podia pegar isso, porque a relação mora entre um arquivo de
// build e um de runtime. Este lê os dois. Ver AUDITORIA.md#BUG-29.
describe("Dockerfile: o healthcheck espera mais que o prazo da rota", () => {
  const dockerfile = readFileSync(
    join(import.meta.dirname, "..", "Dockerfile"),
    "utf8"
  );

  it("o `--timeout` do HEALTHCHECK é MAIOR que o prazo interno de /api/health", () => {
    const doCheck = Number(dockerfile.match(/HEALTHCHECK[^\n]*--timeout=(\d+)s/)?.[1]);
    const daRota = Number(
      readFileSync(join(import.meta.dirname, "..", "app", "api", "health", "route.ts"), "utf8")
        .match(/HEALTH_TIMEOUT_MS\) \|\| ([\d_]+)/)?.[1]
        ?.replace(/_/g, "")
    );

    expect(doCheck).toBeGreaterThan(0);
    expect(daRota).toBeGreaterThan(0);
    // 8 s de rota contra 5 s de checagem era a inversão que derrubava o deploy.
    expect(doCheck * 1000).toBeGreaterThan(daRota);
  });

  it("o healthcheck usa `$PORT`, e não um número fixo", () => {
    // A porta é do host: fixar 3000 aqui faria a checagem bater no lugar errado
    // assim que alguém injetasse outra — que é o que o Coolify faz.
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]{0,400}?\$\{PORT\}/);
  });

  it("`curl` está instalado — o healthcheck depende dele", () => {
    // O próprio Coolify avisa: "The healthcheck needs a curl or wget command".
    expect(dockerfile).toMatch(/apt-get install[^\n]*curl/);
  });
});
