// ============================================================
// Migração que falha NÃO pode matar o contêiner — AUDITORIA.md#BUG-30.
//
// O `docker-entrypoint.sh` roda com `set -e`. Uma chamada nua a
// `node scripts/migrate.mjs` que saia diferente de zero encerra o script, o
// contêiner morre no boot, o healthcheck nunca passa e o Coolify reverte o
// deploy — o MESMO impasse que o `?probe=live` foi resolver, entrando por outra
// porta. E um contêiner morto é o pior estado possível para depurar: não
// responde `/api/health`, não roda o `db-doctor` e não diz a ninguém o que houve.
//
// Subir com o schema atrasado não é fingir que deu certo: o login recusa com
// 503 e texto acionável, e `/api/health` lista as migrações pendentes.
//
// Este teste lê o script porque a relação mora entre um arquivo de shell e o
// comportamento de um orquestrador — nenhum teste de unidade normal a alcança.
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const script = readFileSync(
  join(import.meta.dirname, "..", "docker-entrypoint.sh"),
  "utf8"
);

/** As linhas que INVOCAM o script, ignorando comentários. */
function invocacoesDe(arquivo: string): string[] {
  return script
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .filter((l) => l.includes(`node scripts/${arquivo}`));
}

/**
 * Guardada = o `set -e` não a alcança.
 *
 * `if ! cmd; then` (contexto de condição) ou um `|| …` explícito. Qualquer
 * outra forma deixa a saída não-zero derrubar o script.
 */
function estaGuardada(linha: string): boolean {
  return /^\s*if\s+!\s/.test(linha) || linha.includes("||");
}

describe("docker-entrypoint.sh", () => {
  it("mantém `set -e` — o resto do boot continua tendo de falhar alto", () => {
    // Não é para afrouxar o script inteiro: só as duas chamadas de banco são a
    // exceção, e são exceção por um motivo nomeado.
    expect(script).toMatch(/^set -e$/m);
  });

  it("a migração é invocada, e de forma GUARDADA", () => {
    const linhas = invocacoesDe("migrate.mjs");

    expect(linhas.length).toBeGreaterThan(0);
    for (const l of linhas) {
      expect(estaGuardada(l), `chamada nua derruba o contêiner: ${l.trim()}`).toBe(true);
    }
  });

  it("o seed idem — mesma razão", () => {
    const linhas = invocacoesDe("seed.mjs");

    expect(linhas.length).toBeGreaterThan(0);
    for (const l of linhas) {
      expect(estaGuardada(l), `chamada nua derruba o contêiner: ${l.trim()}`).toBe(true);
    }
  });

  it("falhar em silêncio seria pior: o aviso diz o que fazer", () => {
    // Não derrubar o contêiner só é a decisão certa se a falha continuar
    // gritando. Um boot que engole o erro e serve um app que recusa login é
    // exatamente o modo de falha que o ARQ-12 foi corrigir.
    const aviso = script.slice(script.indexOf("RUN_MIGRATIONS"));

    expect(aviso).toMatch(/AVISO/);
    expect(aviso).toContain("db-doctor.mjs");
  });

  it("as migrações continuam sendo opt-in por `RUN_MIGRATIONS`", () => {
    // Rodar migração a cada boot sem alguém ter pedido é decisão de quem
    // administra, não do contêiner.
    expect(script).toMatch(/RUN_MIGRATIONS:-false/);
  });
});
