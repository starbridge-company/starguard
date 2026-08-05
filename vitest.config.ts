import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Testes de unidade dos módulos PUROS (sem banco, sem rede, sem navegador).
// O ponta a ponta fica em `e2e/` e roda com Playwright contra a app de pé.
//
// Uma suíte só para os três produtos: `npm test` na raiz roda os testes do app
// web (`tests/`) e os do motor (`packages/*/tests/`). Separar em dois comandos
// só criaria a chance de rodar um e esquecer o outro.
export default defineConfig({
  resolve: {
    alias: [
      // Lista ordenada (e não objeto) porque a ORDEM importa: `@` casaria com
      // o começo de `@starguard/core` e resolveria o núcleo para a raiz do app.
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
      // `server-only` é um marcador do Next (falha no build se importado do
      // cliente). Fora do Next ele não resolve — aqui vira um módulo vazio.
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
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    // `tests/live-*` batem em serviço externo REAL (custa dinheiro e exige
    // rede). Ficam fora do run padrão e rodam por `npm run test:live`.
    exclude: ["tests/live-*.test.ts", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["lib/repos/**", "lib/db.ts", "lib/**/*.tsx"],
    },
  },
});
