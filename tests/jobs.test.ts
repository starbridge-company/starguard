import { describe, it, expect } from "vitest";
import { computeProgress, failUnfinishedPhases } from "@/lib/jobs";
import type { Job, PhaseState } from "@/types";

// AUDITORIA.md#BUG-21 (progresso que contradizia o status) e #BUG-11 (análise
// que ficava pendente para sempre, sem dizer por quê).

function phases(
  st: Record<"plan" | "skills" | "software" | "refactor", PhaseState["status"]>
): Job["phases"] {
  const mk = (key: string, status: PhaseState["status"]) =>
    ({ key, label: key, status }) as unknown as PhaseState;
  return {
    plan: mk("plan", st.plan),
    skills: mk("skills", st.skills),
    software: mk("software", st.software),
    refactor: mk("refactor", st.refactor),
  } as unknown as Job["phases"];
}

describe("computeProgress · BUG-21", () => {
  it("NÃO chega a 100% quando uma fase falhou", () => {
    const p = phases({
      plan: "done",
      skills: "done",
      software: "error",
      refactor: "done",
    });
    // Antes: gravava 100 e a lista mostrava "100% · erro" lado a lado.
    expect(computeProgress(p)).toBe(75);
    expect(computeProgress(p)).toBeLessThan(100);
  });

  it("100% só com as quatro fases concluídas", () => {
    expect(
      computeProgress(
        phases({ plan: "done", skills: "done", software: "done", refactor: "done" })
      )
    ).toBe(100);
  });

  it("nada começou = 0%", () => {
    expect(
      computeProgress(
        phases({
          plan: "pending",
          skills: "pending",
          software: "pending",
          refactor: "pending",
        })
      )
    ).toBe(0);
  });

  it("fase em execução ainda não conta como concluída", () => {
    expect(
      computeProgress(
        phases({
          plan: "done",
          skills: "running",
          software: "pending",
          refactor: "pending",
        })
      )
    ).toBe(25);
  });

  it("tudo em erro = 0%, não 100%", () => {
    expect(
      computeProgress(
        phases({ plan: "error", skills: "error", software: "error", refactor: "error" })
      )
    ).toBe(0);
  });
});

describe("failUnfinishedPhases · BUG-11", () => {
  it("dá motivo a toda fase que não terminou", () => {
    const p = phases({
      plan: "done",
      skills: "running",
      software: "pending",
      refactor: "pending",
    });
    failUnfinishedPhases(p, "servidor reiniciou");

    expect(p.skills.status).toBe("error");
    expect(p.skills.error).toBe("servidor reiniciou");
    expect(p.software.status).toBe("error");
    expect(p.refactor.error).toBe("servidor reiniciou");
  });

  it("não reescreve fase concluída nem erro já registrado", () => {
    const p = phases({
      plan: "done",
      skills: "error",
      software: "pending",
      refactor: "pending",
    });
    p.skills.error = "erro original da fase";
    failUnfinishedPhases(p, "motivo genérico");

    expect(p.plan.status).toBe("done");
    expect(p.plan.error).toBeUndefined();
    expect(p.skills.error).toBe("erro original da fase");
  });

  it("carimba o fim das fases que encerrou — a tela mostra duração", () => {
    const p = phases({
      plan: "pending",
      skills: "pending",
      software: "pending",
      refactor: "pending",
    });
    failUnfinishedPhases(p, "x");
    expect(p.plan.finishedAt).toBeTypeOf("number");
  });

  it("combinado com computeProgress: análise abandonada nunca mostra 100%", () => {
    const p = phases({
      plan: "done",
      skills: "running",
      software: "pending",
      refactor: "pending",
    });
    failUnfinishedPhases(p, "servidor reiniciou");
    expect(computeProgress(p)).toBe(25);
  });
});
