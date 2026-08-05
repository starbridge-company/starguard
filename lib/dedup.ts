// Regra única de deduplicação — definida em `@starguard/core/dedup`.
// Isomórfica de propósito: a tela de resultados a usa para não repetir na
// listagem o que o analisador de regras de negócio já filtrou na origem.
// Ver AUDITORIA.md#ARQ-10.
export * from "@starguard/core/dedup";
