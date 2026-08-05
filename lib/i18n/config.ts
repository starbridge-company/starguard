// Idioma: a definição mora no núcleo (`@starguard/core/i18n/config`), porque o
// terminal (`--lang`) e a extensão do VS Code precisam da MESMA lista de
// idiomas e do mesmo `normalizeLocale`. Endereço antigo mantido: `@/lib/i18n/config`
// é o que o middleware (edge), as rotas e os componentes de cliente já importam.
export * from "@starguard/core/i18n/config";
