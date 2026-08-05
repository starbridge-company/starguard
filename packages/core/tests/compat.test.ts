// ============================================================
// Compatibilidade com o formato de fases — AUDITORIA.md#ARQ-13.
//
// Restrição dura: há análises gravadas em produção com
// `phases: {plan,skills,software,refactor}`, e o relatório, a exportação e a
// tela de resultados leem essas linhas. O motor produz `AnalysisRun`; a ponte
// é `compat.ts`, e é ela que impede a reorganização de virar migração de dado
// histórico.
//
// O que estes testes travam, além do mapeamento: que uma aba vazia porque
// ninguém pediu NÃO se confunde com uma aba vazia porque nada foi encontrado
// (UX-15), e que o progresso não contradiz o estado (BUG-21).
// ============================================================
import { describe, it, expect } from "vitest";
import {
  analyzerToPhase,
  phaseAnalyzers,
  phaseStatusFrom,
  phasesFrom,
  progressFrom,
  reasonKey,
  scanResultFrom,
} from "../src/compat";
import type { AnalysisRun, AnalyzerOutcome } from "../src/contracts";

function outcome(p: Partial<AnalyzerOutcome> & { id: AnalyzerOutcome["id"] }): AnalyzerOutcome {
  return { status: "done", degraded: [], ...p };
}

function corrida(outcomes: Record<string, AnalyzerOutcome>): AnalysisRun {
  return {
    plan: { entries: [], source: { type: "none" }, locale: "pt-BR", concurrency: 4 },
    outcomes,
    startedAt: 1,
    finishedAt: 2,
    ok: !Object.values(outcomes).some((o) => o.status === "error"),
  };
}

describe("mapeamento analisador ↔ fase", () => {
  it("três analisadores diferentes caem na MESMA fase `software`", () => {
    // É esta amarração que impedia pedir só o Trivy: `software` embrulhava
    // sast, sca e business numa coisa só.
    expect(analyzerToPhase("sast")).toBe("software");
    expect(analyzerToPhase("sca")).toBe("software");
    expect(analyzerToPhase("business")).toBe("software");
    expect(analyzerToPhase("threat")).toBe("plan");
    expect(analyzerToPhase("skills")).toBe("skills");
  });

  it("`phaseAnalyzers` é o inverso exato", () => {
    expect(phaseAnalyzers("software")).toEqual(["sast", "sca", "business"]);
    expect(phaseAnalyzers("plan")).toEqual(["threat"]);
    expect(phaseAnalyzers("skills")).toEqual(["skills"]);
    // Correção não é analisador: sai sob demanda, por clique (BUG-16).
    expect(phaseAnalyzers("refactor")).toEqual([]);
  });

  it("o motivo vira chave de tradução, não frase pronta", () => {
    expect(reasonKey("binary_missing")).toBe("analyzer.reason.binary_missing");
    expect(reasonKey("not_selected")).toBe("analyzer.reason.not_selected");
  });
});

describe("estado da fase a partir dos analisadores que a compõem", () => {
  it("um erro basta para a fase inteira ser erro", () => {
    expect(
      phaseStatusFrom([
        outcome({ id: "sast", status: "done" }),
        outcome({ id: "sca", status: "error", error: "x" }),
      ])
    ).toBe("error");
  });

  it("todos pulados é `skipped`, NÃO erro", () => {
    // Não pedir o Trivy não é falha. Marcar como erro faria uma escolha
    // deliberada parecer defeito.
    expect(
      phaseStatusFrom([
        outcome({ id: "sast", status: "skipped", reason: "not_selected" }),
        outcome({ id: "sca", status: "skipped", reason: "not_selected" }),
      ])
    ).toBe("skipped");
  });

  it("um concluído entre pulados já torna a fase concluída", () => {
    expect(
      phaseStatusFrom([
        outcome({ id: "sast", status: "skipped", reason: "not_selected" }),
        outcome({ id: "sca", status: "done" }),
      ])
    ).toBe("done");
  });

  it("fase sem analisador nenhum é `skipped`", () => {
    expect(phaseStatusFrom([])).toBe("skipped");
  });
});

describe("scanResultFrom — não confundir 'não achou' com 'não procurou'", () => {
  it("só o SCA rodou: o SAST sai com ran=false e uma nota", () => {
    const r = scanResultFrom(
      {
        sca: outcome({ id: "sca", result: [{ id: "D-1" }] }),
        sast: outcome({ id: "sast", status: "skipped", reason: "not_selected" }),
      },
      "pt-BR"
    );

    expect(r.sca.ran).toBe(true);
    expect(r.sca.dependencies).toHaveLength(1);
    // É `ran` que impede a tela de comemorar "nenhuma vulnerabilidade 🎉"
    // sobre um analisador que ninguém executou. Ver AUDITORIA.md#UX-15.
    expect(r.sast.ran).toBe(false);
    expect(r.sast.vulnerabilities).toEqual([]);
    expect(r.sast.note).toBeTruthy();
  });

  it("analisador em erro entra com ran=false e a mensagem do erro", () => {
    const r = scanResultFrom(
      { sast: outcome({ id: "sast", status: "error", error: "opengrep não encontrado" }) },
      "pt-BR"
    );
    expect(r.sast.ran).toBe(false);
    expect(r.sast.note).toContain("opengrep");
  });

  it("analisador ausente do desfecho também vira nota, não silêncio", () => {
    const r = scanResultFrom({}, "pt-BR");
    expect(r.sast.ran).toBe(false);
    expect(r.sca.ran).toBe(false);
    expect(r.review!.ran).toBe(false);
    expect(r.sast.note).toBeTruthy();
  });
});

describe("phasesFrom", () => {
  it("traduz uma corrida completa para as quatro fases", () => {
    const run = corrida({
      threat: outcome({ id: "threat", result: { threats: [], requirements: [] } }),
      skills: outcome({ id: "skills", result: [] }),
      sast: outcome({ id: "sast", result: [] }),
      sca: outcome({ id: "sca", result: [] }),
      business: outcome({ id: "business", result: { engine: "x", ran: true, findings: [] } }),
    });

    const phases = phasesFrom(run, "pt-BR");

    expect(phases.plan.status).toBe("done");
    expect(phases.skills.status).toBe("done");
    expect(phases.software.status).toBe("done");
    expect(phases.refactor.status).toBe("skipped");
  });

  it("execução só com Trivy deixa as outras fases `skipped`", () => {
    const run = corrida({
      sca: outcome({ id: "sca", result: [] }),
      sast: outcome({ id: "sast", status: "skipped", reason: "not_selected" }),
      business: outcome({ id: "business", status: "skipped", reason: "not_selected" }),
      threat: outcome({ id: "threat", status: "skipped", reason: "not_selected" }),
      skills: outcome({ id: "skills", status: "skipped", reason: "not_selected" }),
    });

    const phases = phasesFrom(run, "pt-BR");

    expect(phases.software.status).toBe("done");
    expect(phases.plan.status).toBe("skipped");
    expect(phases.skills.status).toBe("skipped");
  });

  it("a degradação sai JÁ TRADUZIDA e sem repetição", () => {
    const run = corrida({
      business: outcome({ id: "business", result: {}, degraded: ["sast", "threat"] }),
    });

    const notas = phasesFrom(run, "pt-BR").software.degradedNotes!;

    // Gravado traduzido porque é lido do banco meses depois, sem passar por
    // `t()` na exibição — mesma decisão de `phases[].error` e `sast.note`.
    expect(notas).toHaveLength(2);
    expect(notas.some((n) => /analisador de código/i.test(n))).toBe(true);
    expect(notas.some((n) => /modelagem de amea/i.test(n))).toBe(true);
  });

  it("respeita o idioma pedido", () => {
    const run = corrida({
      business: outcome({ id: "business", result: {}, degraded: ["sast"] }),
    });
    const notas = phasesFrom(run, "es").software.degradedNotes!;
    expect(notas[0]).toMatch(/analizador de código/i);
  });
});

describe("progressFrom — o denominador são as SELECIONADAS", () => {
  it("execução só com Trivy, concluída, dá 100% e não 20%", () => {
    // Com quatro fases fixas, dividir por quatro era certo. Agora, "20% ·
    // concluído" seria a mesma contradição do BUG-21, ao contrário.
    const run = corrida({
      sca: outcome({ id: "sca" }),
      sast: outcome({ id: "sast", status: "skipped", reason: "not_selected" }),
      business: outcome({ id: "business", status: "skipped", reason: "not_selected" }),
      threat: outcome({ id: "threat", status: "skipped", reason: "not_selected" }),
      skills: outcome({ id: "skills", status: "skipped", reason: "not_selected" }),
    });
    expect(progressFrom(run)).toBe(100);
  });

  it("falha parcial NÃO chega a 100%", () => {
    const run = corrida({
      sast: outcome({ id: "sast" }),
      sca: outcome({ id: "sca", status: "error", error: "x" }),
    });
    expect(progressFrom(run)).toBe(50);
  });

  it("nada selecionado é 100%, não 0% — não há trabalho pendente", () => {
    const run = corrida({
      sast: outcome({ id: "sast", status: "skipped", reason: "not_selected" }),
    });
    expect(progressFrom(run)).toBe(100);
  });
});
