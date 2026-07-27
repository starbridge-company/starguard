import { describe, it, expect, vi, beforeEach } from "vitest";

// AUDITORIA.md#ARQ-12 — um banco atrás do código derrubava o login com 500
// para qualquer senha, e a única pista ficava no log do servidor.

// O jornal real tem 5 entradas; fixamos um menor para o teste não depender de
// quantas migrações o repositório tem hoje.
vi.mock("@/db/migrations/meta/_journal.json", () => ({
  default: {
    version: "7",
    dialect: "postgresql",
    entries: [
      { idx: 0, version: "7", when: 1000, tag: "0000_init", breakpoints: true },
      { idx: 1, version: "7", when: 2000, tag: "0001_dois", breakpoints: true },
      { idx: 2, version: "7", when: 3000, tag: "0002_tres", breakpoints: true },
    ],
  },
}));

const execute = vi.fn();
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { checkSchema, schemaMessage, MIGRATE_HINT } = await import("@/lib/schema-check");

/** O driver devolve `{ rows: [...] }`; o helper aceita as duas formas. */
const linhas = (...whens: number[]) => ({
  rows: whens.map((w) => ({ created_at: String(w) })),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkSchema · ARQ-12", () => {
  it("banco em dia: ok e nenhuma pendente", async () => {
    execute.mockResolvedValue(linhas(1000, 2000, 3000));
    const s = await checkSchema(true);
    expect(s.ok).toBe(true);
    expect(s.pending).toEqual([]);
    expect(s.applied).toBe(3);
    expect(s.expected).toBe(3);
  });

  it("banco atrás: aponta QUAIS faltam, na ordem", async () => {
    execute.mockResolvedValue(linhas(1000));
    const s = await checkSchema(true);
    expect(s.ok).toBe(false);
    expect(s.pending).toEqual(["0001_dois", "0002_tres"]);
  });

  it("casa por carimbo, não por contagem — migração fora de ordem é detectada", async () => {
    // Três aplicadas, mas uma delas não é do jornal: contar linhas diria "ok".
    execute.mockResolvedValue(linhas(1000, 2000, 9999));
    const s = await checkSchema(true);
    expect(s.ok).toBe(false);
    expect(s.pending).toEqual(["0002_tres"]);
  });

  it("banco inalcançável não é confundido com banco atrasado", async () => {
    execute.mockRejectedValue(new Error("ECONNREFUSED"));
    const s = await checkSchema(true);
    expect(s.ok).toBe(false);
    expect(s.error).toMatch(/ECONNREFUSED/);
    // `pending` vazio é o sinal de "não sei", e é o que impede o
    // instrumentation.ts de derrubar o processo por uma oscilação de rede.
    expect(s.pending).toEqual([]);
  });

  it("usa cache: a rota /api/health é pública e não pode virar carga no banco", async () => {
    execute.mockResolvedValue(linhas(1000, 2000, 3000));
    await checkSchema(true);
    await checkSchema();
    await checkSchema();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("`force` ignora o cache — quem acabou de migrar vê o resultado", async () => {
    execute.mockResolvedValue(linhas(1000));
    expect((await checkSchema(true)).ok).toBe(false);
    execute.mockResolvedValue(linhas(1000, 2000, 3000));
    expect((await checkSchema(true)).ok).toBe(true);
  });
});

describe("schemaMessage", () => {
  it("diz o comando que conserta", async () => {
    execute.mockResolvedValue(linhas(1000));
    const msg = schemaMessage(await checkSchema(true));
    expect(msg).toContain(MIGRATE_HINT);
    expect(msg).toContain("0001_dois");
  });

  it("banco fora do ar recebe outro texto, não 'desatualizado'", async () => {
    execute.mockRejectedValue(new Error("timeout"));
    const msg = schemaMessage(await checkSchema(true));
    expect(msg).toMatch(/não foi possível verificar/i);
    expect(msg).not.toMatch(/desatualizado/i);
  });

  it("em dia não vira alarme", async () => {
    execute.mockResolvedValue(linhas(1000, 2000, 3000));
    expect(schemaMessage(await checkSchema(true))).toBe("Schema em dia.");
  });
});
