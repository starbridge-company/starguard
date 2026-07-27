// ============================================================
// Abas da tela de resultados.
//
// Módulo PURO, fora do componente, por um motivo: a regra "só Correções tem
// contador" é uma decisão de produto, e montada inline num componente de 1200
// linhas ela só seria verificável abrindo o navegador. Aqui ela tem teste.
//
// Por que só Correções conta: quatro números lado a lado competem entre si.
// "Ameaças 12" ao lado de "Correções 3" dá peso visual a 12 hipóteses NÃO
// verificadas sobre 3 achados exploráveis — o oposto do que a revisão exige de
// si mesma ("nada de vulnerabilidade teórica", lib/review.ts). O contador fica
// onde há trabalho a fazer e de onde sai o Pull Request; o resto se conta ao
// abrir a aba.
// ============================================================
import type { MessageKey } from "@/lib/i18n/translate";

export type TabId = "overview" | "code" | "deps" | "threats" | "skills";

export type TabTone = "default" | "danger" | "warning" | "accent";

export interface ResultsTab {
  id: TabId;
  labelKey: MessageKey;
  count?: number;
  tone?: TabTone;
}

/**
 * A aba de Correções é a única com contador — e o tom vira vermelho quando há
 * crítica aberta, que é o único caso em que a cor carrega informação de risco.
 */
export function buildResultsTabs(input: {
  corrections: number;
  criticals: number;
}): ResultsTab[] {
  return [
    { id: "overview", labelKey: "tab.overview" },
    {
      id: "code",
      labelKey: "tab.fixes",
      count: input.corrections,
      tone: input.criticals > 0 ? "danger" : "accent",
    },
    { id: "deps", labelKey: "tab.deps" },
    { id: "threats", labelKey: "tab.requirements" },
    { id: "skills", labelKey: "tab.skills" },
  ];
}
