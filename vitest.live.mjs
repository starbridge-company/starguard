// Config dos testes que batem em serviço externo REAL (`npm run test:live`).
//
// Separado do vitest.config.ts de propósito: estes gastam dinheiro e exigem
// rede, então NÃO podem entrar no `npm test`. Carrega .env.local para ter as
// chaves de verdade. É como se verifica o AUDITORIA.md#PEND-27 — o contrato
// dos provedores só se prova chamando.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Lista ordenada: `@` casaria com o começo de `@starguard/core`.
    alias: [
      {
        find: /^@starguard\/core$/,
        replacement: fileURLToPath(
          new URL("./packages/core/src/index.ts", import.meta.url)
        ),
      },
      {
        find: /^@starguard\/core\//,
        replacement: fileURLToPath(new URL("./packages/core/src/", import.meta.url)),
      },
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./tests/stubs/empty.ts", import.meta.url)
        ),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/live-*.test.ts"],
    testTimeout: 200_000,
    hookTimeout: 60_000,
    setupFiles: ["./scripts/load-env.mjs"],
  },
});
