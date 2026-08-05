// Correção de dependência vulnerável — definida em `@starguard/core/fix/deps`.
// É o corretor EMBUTIDO no analisador de dependências; o endereço antigo
// permanece porque a tela usa `canFixDependency` para decidir se mostra o botão.
export * from "@starguard/core/fix/deps";
