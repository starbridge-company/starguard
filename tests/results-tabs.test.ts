import { describe, it, expect } from "vitest";
import { buildResultsTabs } from "@/lib/results-tabs";
import { PT_BR } from "@/lib/i18n/messages";
import { LOCALES } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";

// A regra de qual aba carrega contador é decisão de PRODUTO, e antes ela vivia
// inline num componente de 1200 linhas — só o navegador a alcançava. Aqui ela
// tem teste, e a próxima aba acrescentada não desfaz a decisão em silêncio.

describe("abas da tela de resultados", () => {
  const abas = () => buildResultsTabs({ corrections: 3, criticals: 1 });

  it("SÓ Correções tem contador — é de onde sai o Pull Request", () => {
    const comContador = abas().filter((t) => t.count !== undefined);
    expect(comContador.map((t) => t.id)).toEqual(["code"]);
  });

  it("nenhuma aba de leitura mostra número", () => {
    // "Requisitos 12" ao lado de "Correções 3" daria peso visual a 12
    // hipóteses não verificadas sobre 3 achados exploráveis.
    for (const id of ["deps", "threats", "skills", "overview"]) {
      const aba = abas().find((t) => t.id === id)!;
      expect(aba.count, `${id} não pode ter contador`).toBeUndefined();
      expect(aba.tone, `${id} não pode ter tom`).toBeUndefined();
    }
  });

  it("o contador de Correções reflete o número de achados", () => {
    const t = (n: number) =>
      buildResultsTabs({ corrections: n, criticals: 0 }).find((x) => x.id === "code")!;
    expect(t(0).count).toBe(0);
    expect(t(576).count).toBe(576);
  });

  it("o tom só fica vermelho quando há crítica — cor precisa significar algo", () => {
    const tom = (criticals: number) =>
      buildResultsTabs({ corrections: 10, criticals }).find((x) => x.id === "code")!.tone;
    expect(tom(0)).toBe("accent");
    expect(tom(1)).toBe("danger");
  });

  it("a ordem é trabalho primeiro, leitura depois", () => {
    // Correções e Dependências geram PR; Requisitos e Skills são leitura. A
    // ordem não é estética: a tela manda "comece pelas correções" no subtítulo
    // e no CTA da visão geral, e as abas precisam concordar com isso.
    expect(abas().map((t) => t.id)).toEqual([
      "overview",
      "code",
      "deps",
      "threats",
      "skills",
    ]);
  });

  it("toda aba aponta para uma chave que existe nos três idiomas", () => {
    for (const aba of abas()) {
      expect(aba.labelKey in PT_BR, `chave inexistente: ${aba.labelKey}`).toBe(true);
      for (const locale of LOCALES) {
        expect(MESSAGES[locale][aba.labelKey]?.trim()).toBeTruthy();
      }
    }
  });

  it("a aba de requisitos NÃO se chama mais 'Ameaças'", () => {
    // Ela não mostra achado nenhum: mostra o contrato que a Fase 3 confere.
    // As violações vivem em Correções, marcadas com o id do requisito.
    const aba = abas().find((t) => t.id === "threats")!;
    expect(aba.labelKey).toBe("tab.requirements");
    expect(PT_BR["tab.requirements"]).toBe("Requisitos");
    expect(PT_BR["help.threatsText"]).toContain("Correções");
  });
});
