// Flat config. O script `lint` chamava `next lint`, removido no Next 16 —
// era um comando que não existia mais. Ver AUDITORIA.md#BUG-17 e #ARQ-02.
//
// O `eslint-config-next` 16 já exporta flat config nativo; o FlatCompat do
// @eslint/eslintrc não sobrevive ao ESLint 10 (estrutura circular ao validar).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "db/migrations/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  // Traz React/Next + jsx-a11y, que pega boa parte do bloco de acessibilidade
  // levantado na auditoria.
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // `info` é log estruturado de servidor (auditoria, progresso de job) —
      // intencional, não sobra de depuração.
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      // Regra nova do React Compiler, sobre o padrão "efeito busca dados e
      // chama setState". DECISÃO: fica como AVISO, não erro.
      //
      // A análise é estática — ela sinaliza a chamada do loader dentro do
      // efeito e não enxerga através do `await`, então adiar o setState em
      // runtime não a satisfaz. Satisfazê-la exigiria reescrever as 6 telas de
      // listagem num hook de dados, e essas telas estão verificadas em
      // navegador (e2e/). Trocar código funcionando por código novo, sem
      // conseguir revalidar tudo, é risco sem ganho proporcional.
      //
      // O custo real do padrão é um render extra antes da pintura — que é
      // exatamente o spinner de carregamento que queremos mostrar.
      "react-hooks/set-state-in-effect": "warn",
      // Variável não usada com prefixo `_` é intencional.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Scripts de CLI e testes imprimem no console de propósito.
    files: ["scripts/**", "tests/**", "e2e/**"],
    rules: { "no-console": "off" },
  },
];

export default config;
