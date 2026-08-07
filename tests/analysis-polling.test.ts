import { describe, expect, it } from "vitest";
import { allTerminal } from "@/lib/useAnalysisPolling";
import type { Job, PhaseState } from "@/types";

function job(statuses: PhaseState["status"][]): Job {
  const [plan, skills, software, refactor] = statuses;
  const phase = (key: PhaseState["key"], status: PhaseState["status"]): PhaseState => ({
    key,
    label: key,
    status,
  });
  return {
    id: "a",
    createdAt: 1,
    input: {
      projectName: "p",
      systemDescription: "",
      hasToken: false,
      skillNames: [],
      selected: [],
    },
    progress: 100,
    phases: {
      plan: phase("plan", plan!),
      skills: phase("skills", skills!),
      software: phase("software", software!),
      refactor: phase("refactor", refactor!),
    },
  } as Job;
}

describe("fim do polling do painel", () => {
  it("skipped é terminal — Correção sob demanda não mantém polling eterno", () => {
    expect(allTerminal(job(["done", "skipped", "done", "skipped"]))).toBe(true);
  });

  it("continua enquanto alguma fase está pending/running", () => {
    expect(allTerminal(job(["done", "skipped", "running", "skipped"]))).toBe(false);
  });
});
