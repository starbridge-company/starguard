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

// ============================================================
// "A tabela não existe" NÃO é "banco fora do ar" — AUDITORIA.md#BUG-29
// ============================================================
//
// Os dois caíam no mesmo `catch` e saíam idênticos: `error` preenchido,
// `db: "unreachable"` no health e SILÊNCIO no aviso de subida (que ignora
// `error` de propósito, para não alarmar por oscilação de rede).
//
// Só que pedem ações opostas — uma é rede ou credencial, a outra é
// `npm run db:migrate` — e a segunda é a que acontece em TODO servidor novo.
// Foi o caso de um deploy em máquina dedicada: o banco respondia, a migração
// nunca tinha rodado, e a única pista era o worker repetindo de 15 em 15
// segundos a consulta que falhava, sem dizer por quê.
describe("banco vazio é schema ATRASADO, não banco inalcançável", () => {
  /** O erro do Drizzle: mensagem = SQL, código do Postgres em `cause`. */
  const comoDrizzleEmbrulha = (code: string, msg: string) =>
    Object.assign(new Error("Failed query: select created_at from drizzle.__drizzle_migrations"), {
      cause: Object.assign(new Error(msg), { code }),
    });

  it("42P01 (tabela não existe) vira «faltam migrações», com todas pendentes", async () => {
    execute.mockRejectedValue(
      comoDrizzleEmbrulha("42P01", 'relation "drizzle.__drizzle_migrations" does not exist')
    );

    const s = await checkSchema(true);

    expect(s.ok).toBe(false);
    // O que muda tudo: sem `error`, o aviso de subida FALA e o health para de
    // dizer "unreachable" sobre um banco que está respondendo.
    expect(s.error).toBeUndefined();
    expect(s.pending).toHaveLength(3);
    expect(schemaMessage(s)).not.toMatch(/não foi possível verificar/i);
  });

  it("3F000 (schema não existe) idem — é o banco novo, sem o `starguard`", async () => {
    execute.mockRejectedValue(comoDrizzleEmbrulha("3F000", 'schema "drizzle" does not exist'));

    const s = await checkSchema(true);
    expect(s.error).toBeUndefined();
    expect(s.pending).toHaveLength(3);
  });

  it("banco fora do ar CONTINUA sendo inalcançável — não vira «migre»", async () => {
    // Mandar rodar migração num banco que não responde é o conselho errado, e
    // era o risco de generalizar demais este caminho.
    execute.mockRejectedValue(
      Object.assign(new Error("Failed query: select ..."), {
        cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
          code: "ECONNREFUSED",
        }),
      })
    );

    const s = await checkSchema(true);

    expect(s.error).toBeTruthy();
    expect(s.pending).toEqual([]);
    expect(schemaMessage(s)).toMatch(/não foi possível verificar/i);
  });

  it("credencial errada também continua inalcançável", async () => {
    execute.mockRejectedValue(
      Object.assign(new Error("Failed query: select ..."), {
        cause: Object.assign(new Error("password authentication failed for user \"sg\""), {
          code: "28P01",
        }),
      })
    );

    expect((await checkSchema(true)).error).toBeTruthy();
  });

  it("sem código, a frase do Postgres serve de rede de segurança", async () => {
    execute.mockRejectedValue(new Error('relation "drizzle.__drizzle_migrations" does not exist'));
    expect((await checkSchema(true)).error).toBeUndefined();
  });

  it("a dica de migração continua sendo a mesma", () => {
    expect(MIGRATE_HINT).toContain("db:migrate");
  });
});

// ============================================================
// O erro publicado é a CAUSA, não a consulta que falhou
// ============================================================
//
// O `status.error` daqui viaja longe: vira `message` em `/api/health`, vira a
// linha de aviso da subida, e é o que o `starguard doctor` mostra. Ele guardava
// `e.message` — e o Drizzle embrulha toda falha de consulta num erro cuja
// mensagem é o SQL, com o motivo real em `cause`.
//
// O resultado, medido contra a produção de 07/08/2026:
//
//   "message": "Não foi possível verificar o schema: Failed query: select
//    created_at from drizzle.__drizzle_migrations order by created_at params: "
//
// Duas linhas de SQL para dizer "não deu", e nada sobre por quê. Credencial
// errada, banco fora do ar e firewall saíam com o MESMO texto — e são três
// consertos diferentes. É a mesma doença que `mensagemComCausa` já tinha
// curado no log; faltava aqui.
describe("o erro publicado traz a causa, não o SQL", () => {
  const comoDrizzleEmbrulha = (code: string, msg: string) =>
    Object.assign(
      new Error(
        "Failed query: select created_at from drizzle.__drizzle_migrations order by created_at\nparams: "
      ),
      { cause: Object.assign(new Error(msg), { code }) }
    );

  it("banco fora do ar: o ECONNREFUSED aparece", async () => {
    execute.mockRejectedValue(
      comoDrizzleEmbrulha("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.5:5432")
    );

    const s = await checkSchema(true);

    expect(s.error).toContain("ECONNREFUSED 10.0.0.5:5432");
  });

  it("credencial errada: a frase do Postgres aparece, com o código", async () => {
    // `[28P01]` vale mais que a frase: a frase muda entre versões do Postgres,
    // o código não.
    execute.mockRejectedValue(
      comoDrizzleEmbrulha("28P01", 'password authentication failed for user "sg"')
    );

    const s = await checkSchema(true);

    expect(s.error).toContain("28P01");
    expect(s.error).toContain("password authentication failed");
  });

  it("os dois casos deixam de ser INDISTINGUÍVEIS — era o defeito", async () => {
    execute.mockRejectedValue(comoDrizzleEmbrulha("ECONNREFUSED", "connect ECONNREFUSED"));
    const fora = (await checkSchema(true)).error;

    execute.mockRejectedValue(comoDrizzleEmbrulha("28P01", "password authentication failed"));
    const credencial = (await checkSchema(true)).error;

    expect(fora).not.toBe(credencial);
  });

  it("NÃO vaza a senha: este texto vai para a resposta HTTP", async () => {
    // O erro de conexão do `pg` carrega a string de conexão inteira. Seguir a
    // corrente de `cause` sem redigir teria ampliado o vazamento em vez de
    // consertar o diagnóstico. Ver `redact.ts`.
    execute.mockRejectedValue(
      comoDrizzleEmbrulha(
        "ECONNREFUSED",
        "connect ECONNREFUSED: postgres://sg:senha-secreta@db-interno:5432/starguard"
      )
    );

    const s = await checkSchema(true);

    expect(s.error).not.toContain("senha-secreta");
    // Mas o HOST sobrevive à redação — é justamente o que se quer saber.
    expect(s.error).toContain("db-interno:5432");
  });
});
