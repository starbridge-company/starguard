import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Testes de unidade dos módulos PUROS (sem banco, sem rede, sem navegador).
// O ponta a ponta fica em `e2e/` e roda com Playwright contra a app de pé.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` é um marcador do Next (falha no build se importado do
      // cliente). Fora do Next ele não resolve — aqui vira um módulo vazio.
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // `tests/live-*` batem em serviço externo REAL (custa dinheiro e exige
    // rede). Ficam fora do run padrão e rodam por `npm run test:live`.
    exclude: ["tests/live-*.test.ts", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/repos/**", "lib/db.ts", "lib/**/*.tsx"],
    },
  },
});
