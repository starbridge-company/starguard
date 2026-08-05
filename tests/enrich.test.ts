import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Vulnerability, DependencyVuln } from "@/types";

// A camada de IA é mockada: assim os caminhos que dependiam de chave de API
// passam a ser testáveis. Resolve AUDITORIA.md#PEND-13 (enriquecimento por IA
// nunca exercitado) sem precisar de rede nem de crédito.
const runAI = vi.fn();
vi.mock("@starguard/core/ai", async () => {
  const real = await vi.importActual<typeof import("@starguard/core/ai")>("@starguard/core/ai");
  return { ...real, runAI: (...a: unknown[]) => runAI(...a) };
});

const { enrichFindings, enrichDependencies } = await import("@starguard/core/enrich");

function vuln(over: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "V-1",
    source: "sast",
    ruleId: "detect-child-process",
    title: "Detected child_process",
    severity: "high",
    file: "src/a.js",
    line: 3,
    description: "original em inglês",
    suggestion: "",
    ...over,
  };
}

beforeEach(() => runAI.mockReset());

describe("enrichFindings · FEAT-03", () => {
  it("regra conhecida vem do CATÁLOGO, sem tocar na IA", async () => {
    const [out] = await enrichFindings([vuln()]);
    expect(out.explain?.source).toBe("catalog");
    expect(runAI).not.toHaveBeenCalled();
  });

  it("regra desconhecida vai para a IA e o texto é aplicado", async () => {
    runAI.mockResolvedValue(
      JSON.stringify({
        "regra-nova|": {
          title: "Título curto",
          whatItIs: "O que é.",
          whyItMatters: "Por que importa.",
          attackScenario: "Como explorar.",
          howToFix: "Como corrigir.",
        },
      })
    );
    const [out] = await enrichFindings([vuln({ ruleId: "regra-nova" })]);
    expect(runAI).toHaveBeenCalledTimes(1);
    expect(out.explain).toMatchObject({
      source: "ai",
      title: "Título curto",
      howToFix: "Como corrigir.",
    });
  });

  // O ponto central do desenho: 30 achados de 2 regras = 1 chamada, não 30.
  it("agrupa por REGRA — uma única chamada para muitos achados", async () => {
    runAI.mockResolvedValue(
      JSON.stringify({
        "regra-a|": { whatItIs: "a", howToFix: "a" },
        "regra-b|": { whatItIs: "b", howToFix: "b" },
      })
    );
    const muitos = [
      ...Array.from({ length: 15 }, (_, i) => vuln({ id: `V-${i}`, ruleId: "regra-a" })),
      ...Array.from({ length: 15 }, (_, i) => vuln({ id: `W-${i}`, ruleId: "regra-b" })),
    ];
    const out = await enrichFindings(muitos);
    expect(runAI).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(30);
    expect(out.every((f) => f.explain?.source === "ai")).toBe(true);
  });

  // Falha da IA NÃO pode derrubar o scan. Simulamos pela resposta sem JSON —
  // que é um modo de falha real e documentado (o "thinking" consome o
  // orçamento e o texto volta vazio). O caminho de exceção do `runAI` chega no
  // MESMO `catch`; testá-lo por lançamento faria o runner contabilizar o erro
  // do mock mesmo estando capturado.
  it("IA indisponível NÃO derruba o scan — mantém o texto original marcado", async () => {
    runAI.mockResolvedValue("desculpe, não consegui responder");
    const [out] = await enrichFindings([vuln({ ruleId: "regra-nova" })]);
    expect(out.explain?.source).toBe("scanner");
    expect(out.explain?.whatItIs).toBe("Detected child_process");
  });

  it("resposta incompleta da IA é descartada, não aplicada pela metade", async () => {
    runAI.mockResolvedValue(JSON.stringify({ "regra-nova|": { whatItIs: "só isso" } }));
    const [out] = await enrichFindings([vuln({ ruleId: "regra-nova" })]);
    expect(out.explain?.source).toBe("scanner"); // faltou howToFix
  });

  it("o idioma pedido chega ao prompt", async () => {
    runAI.mockResolvedValue("{}");
    await enrichFindings([vuln({ ruleId: "regra-nova" })], "en");
    const [, opts] = runAI.mock.calls[0] as [string, { system: string }];
    const system = opts.system;
    expect(system).toMatch(/ENGLISH/i);
  });

  it("lista vazia não chama nada", async () => {
    expect(await enrichFindings([])).toEqual([]);
    expect(runAI).not.toHaveBeenCalled();
  });
});

// AUDITORIA.md#PEND-15 — dependências ganham texto por template, sem IA.
describe("enrichDependencies · PEND-15", () => {
  const dep: DependencyVuln = {
    id: "D-1",
    source: "sca",
    package: "lodash",
    installedVersion: "4.17.4",
    fixedVersion: "4.17.12",
    severity: "critical",
    cve: "CVE-2019-10744",
    title: "Prototype pollution",
    description: "…",
  };

  it("diz para onde atualizar", () => {
    const [out] = enrichDependencies([dep]);
    expect(out.explain?.source).toBe("catalog");
    expect(out.explain?.howToFix).toContain("4.17.12");
    expect(out.explain?.whatItIs).toContain("lodash@4.17.4");
  });

  it("sem versão corrigida, orienta o que fazer em vez de mandar atualizar", () => {
    const [out] = enrichDependencies([{ ...dep, fixedVersion: undefined }]);
    expect(out.explain?.howToFix).not.toMatch(/Atualize/);
    expect(out.explain?.howToFix).toContain("CVE-2019-10744");
  });

  it("responde no idioma pedido", () => {
    expect(enrichDependencies([dep], "en")[0]!.explain?.howToFix).toMatch(/Upgrade/);
    expect(enrichDependencies([dep], "pt-BR")[0]!.explain?.howToFix).toMatch(/Atualize/);
  });
});
