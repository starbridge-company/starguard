// ============================================================
// Achatamento dos achados no terminal — AUDITORIA.md#ARQ-13.
//
// Este arquivo nasceu de um bug encontrado RODANDO o comando, não lendo o
// código: `starguard skills arquivo.md` mostrava "Skills e prompts  2" na
// lista de analisadores e, três linhas abaixo, "Nenhum achado 🎉". Dois
// achados reais reportados como limpo — o pior desfecho possível para uma
// ferramenta de segurança.
//
// Nem o tipo nem o build pegariam: `achadosDe` simplesmente não olhava para
// `outcomes.skills`. É o mesmo padrão dos dois bugs citados no CLAUDE.md — só
// executar revelou.
// ============================================================
import { describe, it, expect } from "vitest";
import { achadosDe } from "../src/render";
import type { AnalysisRun, AnalyzerOutcome } from "@starguard/core/contracts";
import type {
  DependencyVuln,
  SkillFinding,
  SkillValidation,
  Vulnerability,
} from "@starguard/core/types";

function corrida(outcomes: Record<string, Partial<AnalyzerOutcome>>): AnalysisRun {
  return {
    plan: { entries: [], source: { type: "none" }, locale: "pt-BR", concurrency: 4 },
    outcomes: Object.fromEntries(
      Object.entries(outcomes).map(([id, o]) => [
        id,
        { id, status: "done", degraded: [], ...o } as AnalyzerOutcome,
      ])
    ),
    startedAt: 1,
    finishedAt: 2,
    ok: true,
  };
}

const skillFinding = (p: Partial<SkillFinding> = {}): SkillFinding => ({
  id: "H-0",
  type: "prompt-injection",
  severity: "critical",
  title: "Possível prompt injection",
  description: "trecho suspeito",
  recommendation: "remova a instrução",
  line: 7,
  ...p,
});

const validacao = (p: Partial<SkillValidation> = {}): SkillValidation => ({
  skillName: "minha-skill.md",
  verdict: "rejected",
  findings: [skillFinding()],
  checkedItems: [],
  ...p,
});

describe("achados de SKILL aparecem na tabela", () => {
  it("uma skill com 2 achados produz 2 linhas — e não 'nenhum achado'", () => {
    const r = achadosDe(
      corrida({
        skills: {
          result: [
            validacao({
              findings: [
                skillFinding({ id: "H-0" }),
                skillFinding({ id: "H-1", type: "data-exfiltration", severity: "high" }),
              ],
            }),
          ],
        },
      })
    );
    expect(r).toHaveLength(2);
    expect(r.map((a) => a.analyzer)).toEqual(["skills", "skills"]);
  });

  it("o ARQUIVO é o nome da skill — é o que localiza o achado", () => {
    const [a] = achadosDe(corrida({ skills: { result: [validacao()] } }));
    expect(a!.file).toBe("minha-skill.md");
    expect(a!.line).toBe(7);
  });

  it("o tipo da heurística vira a REGRA da tabela", () => {
    const [a] = achadosDe(corrida({ skills: { result: [validacao()] } }));
    expect(a!.ruleId).toBe("prompt-injection");
    expect(a!.suggestion).toBe("remova a instrução");
  });

  it("várias skills no mesmo comando entram todas", () => {
    const r = achadosDe(
      corrida({
        skills: {
          result: [validacao({ skillName: "a.md" }), validacao({ skillName: "b.md" })],
        },
      })
    );
    expect(r.map((x) => x.file)).toEqual(["a.md", "b.md"]);
  });

  it("skill aprovada não gera linha nenhuma", () => {
    const r = achadosDe(
      corrida({
        skills: { result: [validacao({ verdict: "approved", findings: [] })] },
      })
    );
    expect(r).toHaveLength(0);
  });
});

describe("as quatro origens convivem, ordenadas por gravidade", () => {
  it("skill crítica vem antes de dependência alta", () => {
    const dep: DependencyVuln = {
      id: "D-1",
      source: "sca",
      package: "postcss",
      installedVersion: "8.4.31",
      severity: "high",
      cve: "CVE-1",
      title: "t",
      description: "d",
      manifest: "package.json",
    };
    const v: Vulnerability = {
      id: "V-1",
      source: "sast",
      ruleId: "regra",
      title: "sqli",
      severity: "medium",
      file: "app.ts",
      line: 3,
      description: "d",
      suggestion: "",
    };

    const r = achadosDe(
      corrida({
        sca: { result: [dep] },
        sast: { result: [v] },
        skills: { result: [validacao()] },
      })
    );

    expect(r.map((a) => a.analyzer)).toEqual(["skills", "sca", "sast"]);
  });

  it("analisador pulado não contribui", () => {
    const r = achadosDe(
      corrida({
        skills: { status: "skipped", reason: "no_input", result: undefined },
      })
    );
    expect(r).toHaveLength(0);
  });
});
