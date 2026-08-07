// ============================================================
// O log tem de dizer POR QUE falhou, não repetir a consulta.
//
// Relatado de um deploy em servidor dedicado: esta linha, a cada 15 segundos,
// para sempre —
//
//   {"level":"error","event":"worker.loop.failed","error":"Failed query:
//     UPDATE starguard.jobs SET status = 'running' … RETURNING id, kind, …
//     params: 7-a35963f3"}
//
// Um paredão de SQL e **zero informação sobre a causa**. Schema atrasado,
// credencial errada e banco fora do ar produziam exatamente a mesma linha — e
// os três pedem consertos diferentes.
//
// A culpa não era do Drizzle: ele embrulha a falha num erro cuja mensagem é o
// SQL e guarda o motivo real em `cause` (`relation … does not exist`,
// `password authentication failed`, `ECONNREFUSED`). Era o nosso `safe()` que
// fazia `redact(v.message)` e jogava a corrente de `cause` fora.
//
// Ver AUDITORIA.md#BUG-29.
// ============================================================
import { describe, it, expect, afterEach, vi } from "vitest";

const linhas: string[] = [];
const espiao = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
  linhas.push(a.map(String).join(" "));
});

const { log } = await import("../src/logger");

afterEach(() => {
  linhas.length = 0;
});

/** O erro que o Drizzle produz: mensagem = SQL, motivo real em `cause`. */
function erroDoDrizzle(causa: Error) {
  return Object.assign(
    new Error("Failed query: UPDATE starguard.jobs SET status = 'running'\nparams: 7-a3"),
    { cause: causa }
  );
}

describe("a causa do erro chega ao log", () => {
  it("o motivo do Postgres aparece — era ele que sumia", () => {
    const pg = Object.assign(new Error('relation "starguard.jobs" does not exist'), {
      code: "42P01",
    });

    log.error("worker.loop.failed", { error: erroDoDrizzle(pg) });

    const saida = linhas.join("\n");
    // Antes da correção, SÓ isto aparecia:
    expect(saida).toContain("Failed query");
    // E isto, que é a resposta, não aparecia:
    expect(saida).toContain("does not exist");
    // O código do Postgres identifica o problema melhor que a frase: 42P01 é
    // "tabela não existe", ou seja, migração não aplicada.
    expect(saida).toContain("42P01");
  });

  it("distingue banco fora do ar de schema atrasado", () => {
    const socket = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
      code: "ECONNREFUSED",
    });

    log.error("worker.loop.failed", { error: erroDoDrizzle(socket) });

    const saida = linhas.join("\n");
    expect(saida).toContain("ECONNREFUSED");
    // As duas situações saíam com a MESMA linha antes disto.
    expect(saida).not.toContain("42P01");
  });

  it("segue mais de um elo da corrente", () => {
    const raiz = new Error("getaddrinfo ENOTFOUND db.interno");
    const meio = Object.assign(new Error("pool error"), { cause: raiz });

    log.error("x", { error: erroDoDrizzle(meio) });

    const saida = linhas.join("\n");
    expect(saida).toContain("pool error");
    expect(saida).toContain("ENOTFOUND");
  });

  it("um ciclo de `cause` não trava o log", () => {
    const a = new Error("a");
    const b = Object.assign(new Error("b"), { cause: a });
    (a as { cause?: unknown }).cause = b;

    // Sem a proteção, isto não retornaria nunca.
    expect(() => log.error("ciclo", { error: a })).not.toThrow();
    expect(linhas.join("")).toContain("a");
  });

  it("a senha do banco NÃO vaza pela causa", () => {
    // O erro de conexão do `pg` costuma trazer a URL inteira. É por isso que
    // cada elo passa por `redact`, e não só a mensagem de fora.
    const comSenha = new Error(
      "connection failed: postgres://sg:SenhaSuperSecreta@db.interno:5432/starguard"
    );

    log.error("worker.loop.failed", { error: erroDoDrizzle(comSenha) });

    const saida = linhas.join("\n");
    expect(saida).not.toContain("SenhaSuperSecreta");
  });

  it("erro sem `cause` continua saindo igual", () => {
    log.error("simples", { error: new Error("só isso") });
    expect(linhas.join("")).toContain("só isso");
  });
});

afterEach(() => espiao.mockClear());
