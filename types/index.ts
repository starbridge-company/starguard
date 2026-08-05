// ============================================================
// Tipos de domínio do StarGuard.
//
// A definição mora em `@starguard/core/types`: os tipos descrevem o que o
// MOTOR produz (achado, resultado de scan, correção, plano de execução), e o
// motor agora serve três lugares — o painel web, o terminal e a extensão do
// VS Code. Deixá-los aqui obrigaria o CLI a depender do app Next só para saber
// o que é uma `Vulnerability`.
//
// Este arquivo continua existindo porque `@/types` é o endereço que 34 arquivos
// do app já usam, incluindo componentes de cliente. Como tipo é apagado na
// compilação, reexportar não custa nada em runtime nem carrega o núcleo para
// dentro do bundle do navegador.
// ============================================================
export * from "@starguard/core/types";
