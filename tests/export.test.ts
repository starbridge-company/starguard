import { describe, it, expect } from "vitest";
import {
  toSarif,
  toCsv,
  toJson,
  exportAnalysis,
  isExportFormat,
  exportFilename,
  collectCodeFindings,
} from "@starguard/core/export";
import type { Job, Vulnerability, DependencyVuln } from "@/types";

// AUDITORIA.md#UX-10 — a única saída era window.print().

function vuln(p: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "V-1",
    source: "sast",
    ruleId: "detect-child-process",
    title: "Command injection",
    severity: "critical",
    file: "src/api/run.ts",
    line: 42,
    description: "Executa comando com entrada não validada.",
    suggestion: "Valide a entrada.",
    cwe: "CWE-78",
    ...p,
  } as Vulnerability;
}

function dep(p: Partial<DependencyVuln> = {}): DependencyVuln {
  return {
    id: "D-1",
    source: "sca",
    package: "lodash",
    installedVersion: "4.17.20",
    fixedVersion: "4.17.21",
    severity: "high",
    cve: "CVE-2021-23337",
    title: "Command injection em lodash",
    description: "Versão vulnerável.",
    ...p,
  } as DependencyVuln;
}

function job(p: {
  sast?: Vulnerability[];
  review?: Vulnerability[];
  sca?: DependencyVuln[];
  projectName?: string;
} = {}): Job {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    createdAt: 1750000000000,
    input: {
      projectName: p.projectName ?? "Meu Projeto",
      systemDescription: "d",
      repoUrl: "https://github.com/acme/app",
      hasToken: false,
      skillNames: [],
    },
    progress: 100,
    phases: {
      plan: { key: "plan", label: "plan", status: "done" },
      skills: { key: "skills", label: "skills", status: "done" },
      software: {
        key: "software",
        label: "software",
        status: "done",
        result: {
          sast: { engine: "opengrep", ran: true, vulnerabilities: p.sast ?? [] },
          sca: { engine: "trivy", ran: true, dependencies: p.sca ?? [] },
          review: p.review
            ? { engine: "ai", ran: true, findings: p.review }
            : undefined,
        },
      },
      refactor: { key: "refactor", label: "refactor", status: "done" },
    },
  } as unknown as Job;
}

describe("isExportFormat", () => {
  it("aceita só os três formatos", () => {
    expect(isExportFormat("sarif")).toBe(true);
    expect(isExportFormat("csv")).toBe(true);
    expect(isExportFormat("json")).toBe(true);
    expect(isExportFormat("xml")).toBe(false);
    expect(isExportFormat(null)).toBe(false);
  });
});

describe("collectCodeFindings", () => {
  it("junta SAST e IA aplicando a MESMA dedup da tela", () => {
    const sast = vuln({ id: "V-1", cwe: "CWE-89", line: 40 });
    const duplicado = vuln({
      id: "AI-1",
      source: "ai-review",
      cwe: "CWE-89",
      line: 41,
    });
    const distinto = vuln({
      id: "AI-2",
      source: "ai-review",
      cwe: "CWE-639",
      line: 41,
    });
    const out = collectCodeFindings(job({ sast: [sast], review: [duplicado, distinto] }));
    expect(out.map((f) => f.id)).toEqual(["V-1", "AI-2"]);
  });

  it("análise sem fase de scan exporta lista vazia, sem quebrar", () => {
    const j = job();
    j.phases.software.result = undefined;
    expect(collectCodeFindings(j)).toEqual([]);
  });
});

describe("toSarif · SARIF 2.1.0", () => {
  const parse = (j: Job) => JSON.parse(toSarif(j));

  it("tem versão, schema e um run com o driver", () => {
    const s = parse(job({ sast: [vuln()] }));
    expect(s.version).toBe("2.1.0");
    expect(s.$schema).toMatch(/sarif-schema-2\.1\.0\.json$/);
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0].tool.driver.name).toBe("StarGuard");
  });

  it("cada result aponta para uma regra existente pelo índice", () => {
    const s = parse(job({ sast: [vuln({ id: "V-1" }), vuln({ id: "V-2", line: 90 })] }));
    const { rules, results } = { rules: s.runs[0].tool.driver.rules, results: s.runs[0].results };
    for (const r of results) {
      expect(rules[r.ruleIndex].id).toBe(r.ruleId);
    }
  });

  it("regra repetida entra uma vez só na lista de regras", () => {
    const s = parse(job({ sast: [vuln({ id: "V-1" }), vuln({ id: "V-2", line: 90 })] }));
    expect(s.runs[0].tool.driver.rules).toHaveLength(1);
    expect(s.runs[0].results).toHaveLength(2);
  });

  it("mapeia severidade para nível e para security-severity numérica", () => {
    const s = parse(
      job({
        sast: [
          vuln({ id: "V-1", severity: "critical", ruleId: "r-crit" }),
          vuln({ id: "V-2", severity: "medium", ruleId: "r-med" }),
          vuln({ id: "V-3", severity: "info", ruleId: "r-info" }),
        ],
      })
    );
    const byRule = Object.fromEntries(
      s.runs[0].results.map((r: { ruleId: string; level: string }) => [r.ruleId, r.level])
    );
    expect(byRule["r-crit"]).toBe("error");
    expect(byRule["r-med"]).toBe("warning");
    expect(byRule["r-info"]).toBe("note");

    const crit = s.runs[0].tool.driver.rules.find(
      (r: { id: string }) => r.id === "r-crit"
    );
    expect(Number(crit.properties["security-severity"])).toBeGreaterThan(9);
  });

  it("normaliza o caminho: separador do Windows e './' viram URI relativa", () => {
    const s = parse(job({ sast: [vuln({ file: ".\\src\\api\\run.ts" })] }));
    expect(
      s.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri
    ).toBe("src/api/run.ts");
  });

  it("linha 0 (não localizado) vira startLine 1 — SARIF conta a partir de 1", () => {
    const s = parse(job({ sast: [vuln({ line: 0 })] }));
    expect(s.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(1);
  });

  it("faixa de linhas é preservada", () => {
    const s = parse(job({ sast: [vuln({ line: 10, endLine: 20 })] }));
    const region = s.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region).toEqual({ startLine: 10, endLine: 20 });
  });

  it("todo result tem partialFingerprints — senão o Code Scanning reabre tudo a cada push", () => {
    const s = parse(job({ sast: [vuln()], sca: [dep()] }));
    for (const r of s.runs[0].results) {
      expect(r.partialFingerprints?.starguardFingerprint).toBeTruthy();
    }
  });

  it("achado de dependência entra com localização válida (senão o GitHub descarta)", () => {
    const s = parse(job({ sca: [dep()] }));
    const r = s.runs[0].results[0];
    expect(r.ruleId).toBe("CVE-2021-23337");
    expect(r.locations[0].physicalLocation.artifactLocation.uri).toBeTruthy();
    expect(r.locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
  });

  it("CWE e origem viram tags da regra", () => {
    const s = parse(job({ sast: [vuln({ cwe: "CWE-78", owasp: "A03" })] }));
    const tags = s.runs[0].tool.driver.rules[0].properties.tags;
    expect(tags).toContain("CWE-78");
    expect(tags).toContain("A03");
    expect(tags).toContain("sast");
  });

  it("análise sem achado nenhum ainda gera SARIF válido", () => {
    const s = parse(job());
    expect(s.runs[0].results).toEqual([]);
    expect(s.runs[0].tool.driver.rules).toEqual([]);
  });

  it("descrição não tem quebra de linha (shortDescription é uma linha só)", () => {
    const s = parse(
      job({ sast: [vuln({ title: "linha 1\nlinha 2\n\nlinha 3" })] })
    );
    expect(s.runs[0].tool.driver.rules[0].shortDescription.text).not.toMatch(/\n/);
  });
});

describe("toCsv", () => {
  it("tem cabeçalho e uma linha por achado", () => {
    const csv = toCsv(job({ sast: [vuln()], sca: [dep()] }));
    const linhas = csv.trim().split("\r\n");
    expect(linhas[0]).toContain("severidade");
    expect(linhas).toHaveLength(3); // cabeçalho + 2
  });

  it("começa com BOM — sem ele o Excel estraga o acento", () => {
    expect(toCsv(job()).charCodeAt(0)).toBe(0xfeff);
  });

  it("escapa vírgula e aspas em vez de quebrar as colunas", () => {
    const csv = toCsv(job({ sast: [vuln({ title: 'tem, vírgula e "aspas"' })] }));
    expect(csv).toContain('"tem, vírgula e ""aspas"""');
  });

  it("neutraliza injeção de fórmula do Excel", () => {
    // O texto vem de um repositório de terceiros: uma célula começando com "="
    // é executada como fórmula ao abrir a planilha.
    const csv = toCsv(job({ sast: [vuln({ title: "=cmd|'/c calc'!A1" })] }));
    expect(csv).toMatch(/'=cmd/);
    expect(csv).not.toMatch(/(^|,)=cmd/m);
  });

  it("quebra de linha na descrição não vira linha nova no CSV", () => {
    const csv = toCsv(job({ sast: [vuln({ description: "a\nb\nc" })] }));
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });
});

describe("toJson", () => {
  it("carrega metadados, cobertura e os dois conjuntos de achados", () => {
    const j = JSON.parse(toJson(job({ sast: [vuln()], sca: [dep()] })));
    expect(j.analysisId).toBeTruthy();
    expect(j.repoUrl).toBe("https://github.com/acme/app");
    expect(j.findings).toHaveLength(1);
    expect(j.dependencies).toHaveLength(1);
    // A honestidade do UX-15 precisa sobreviver à exportação.
    expect(j.coverage).toEqual({ sastRan: true, scaRan: true, reviewRan: false });
  });

  it("scanner que não rodou aparece como não rodado, não como 'zero achados'", () => {
    const j = job();
    j.phases.software.result!.sast.ran = false;
    expect(JSON.parse(toJson(j)).coverage.sastRan).toBe(false);
  });
});

// AUDITORIA.md#FEAT-04 — o arquivo baixado também tem idioma. A distinção
// entre CSV e JSON é DELIBERADA e precisa ficar registrada em teste: quem abre
// o CSV é uma pessoa no Excel; quem consome o JSON é um pipeline, e mudar as
// chaves dele conforme o idioma quebraria o consumidor do outro lado.
describe("exportação · idioma do arquivo baixado", () => {
  const comAchados = () => job({ sast: [vuln()], sca: [dep()] });

  it("o cabeçalho do CSV acompanha o idioma", () => {
    const pt = toCsv(job(), "pt-BR").split("\r\n")[0]!;
    const en = toCsv(job(), "en").split("\r\n")[0]!;
    const es = toCsv(job(), "es").split("\r\n")[0]!;

    expect(pt).toContain("severidade");
    expect(en).toContain("severity");
    expect(es).toContain("severidad");
    expect(new Set([pt, en, es]).size).toBe(3);
  });

  it("sem idioma informado o CSV sai em português", () => {
    expect(toCsv(job()).split("\r\n")[0]).toBe(toCsv(job(), "pt-BR").split("\r\n")[0]);
  });

  it("as CHAVES do JSON NÃO mudam com o idioma — é contrato de máquina", () => {
    const chaves = (locale: Parameters<typeof exportAnalysis>[2]) =>
      Object.keys(JSON.parse(exportAnalysis(job(), "json", locale))).sort();
    expect(chaves("en")).toEqual(chaves("pt-BR"));
    expect(chaves("es")).toEqual(chaves("pt-BR"));
  });

  it("o SARIF continua válido e a ajuda da dependência é traduzida", () => {
    // O `help.text` da regra de dependência é o texto que o GitHub Code
    // Scanning mostra ao revisor — sem locale ele ficava preso em português.
    const ajuda = (locale: "pt-BR" | "en" | "es") => {
      const s = JSON.parse(toSarif(comAchados(), locale));
      expect(s.version).toBe("2.1.0");
      expect(s.runs[0].results.length).toBeGreaterThan(0);
      const regra = s.runs[0].tool.driver.rules.find(
        (r: { id: string }) => r.id === "CVE-2021-23337"
      );
      return regra.help.text as string;
    };
    expect(ajuda("pt-BR")).toContain("4.17.21");
    expect(new Set([ajuda("pt-BR"), ajuda("en"), ajuda("es")]).size).toBe(3);
  });
});

describe("exportFilename", () => {
  it("gera nome seguro a partir do projeto", () => {
    expect(exportFilename(job({ projectName: "Meu Projeto" }), "sarif")).toBe(
      "starguard-meu-projeto-3f2504e0.sarif"
    );
  });

  it("remove acento e caractere que quebraria o Content-Disposition", () => {
    const nome = exportFilename(job({ projectName: 'Análise "X"; rm -rf /' }), "csv");
    expect(nome).toBe("starguard-analise-x-rm-rf-3f2504e0.csv");
    expect(nome).not.toMatch(/["\\/;]/);
  });

  it("projeto só com símbolos ainda produz um nome utilizável", () => {
    expect(exportFilename(job({ projectName: "!!!" }), "json")).toMatch(
      /^starguard-analise-3f2504e0\.json$/
    );
  });
});
