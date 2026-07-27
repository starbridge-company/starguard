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
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/stubs/empty.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live-*.test.ts"],
    testTimeout: 200_000,
    hookTimeout: 60_000,
    setupFiles: ["./scripts/load-env.mjs"],
  },
});
