// Ponto de entrada do idioma para quem consome o núcleo de fora: o terminal,
// a extensão do VS Code e o provider React do app (`lib/i18n/index.tsx`).
// Puro — sem React e sem Node —, então serve o servidor, o cliente e o edge.
export * from "./config";
export * from "./messages";
export * from "./translate";
