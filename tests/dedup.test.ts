import { describe, it, expect } from "vitest";
import { collidesWithSast, collidesWithSca, normPath } from "@/lib/dedup";
import type { DependencyVuln, Vulnerability } from "@/types";

// AUDITORIA.md#BUG-15: proximidade sozinha descartava achado legítimo.
// AUDITORIA.md#ARQ-10: servidor e tela usavam critérios diferentes; agora é
// este módulo, e só ele.

function vuln(p: Partial<Vulnerability>): Vulnerability {
  return {
    id: "X-1",
    source: "sast",
    ruleId: "regra",
    title: "t",
    severity: "high",
    file: "src/api/user.ts",
    line: 40,
    description: "d",
    suggestion: "s",
    ...p,
  } as Vulnerability;
}

describe("collidesWithSast · BUG-15", () => {
  it("NÃO descarta um IDOR na 40 porque o SAST achou outra coisa na 42", () => {
    // O caso exato do relatório: perto, mesmo arquivo, problemas distintos.
    const idor = vuln({ id: "AI-1", source: "ai-review", cwe: "CWE-639", line: 40 });
    const log = vuln({ id: "V-1", cwe: "CWE-532", line: 42, ruleId: "no-console" });
    expect(collidesWithSast(idor, [log])).toBe(false);
  });

  it("descarta quando o CWE é o mesmo e a linha é próxima", () => {
    const ia = vuln({ id: "AI-1", source: "ai-review", cwe: "CWE-89", line: 40 });
    const sast = vuln({ id: "V-1", cwe: "CWE-89", line: 42 });
    expect(collidesWithSast(ia, [sast])).toBe(true);
  });

  it("mesmo CWE mas longe: são ocorrências distintas, ambas ficam", () => {
    const ia = vuln({ id: "AI-1", source: "ai-review", cwe: "CWE-89", line: 40 });
    const sast = vuln({ id: "V-1", cwe: "CWE-89", line: 300 });
    expect(collidesWithSast(ia, [sast])).toBe(false);
  });

  it("sem CWE dos dois lados, a proximidade decide", () => {
    const ia = vuln({ id: "AI-1", source: "ai-review", cwe: undefined, line: 41 });
    const sast = vuln({ id: "V-1", cwe: undefined, line: 42 });
    expect(collidesWithSast(ia, [sast])).toBe(true);
  });

  it("arquivo diferente nunca colide, por mais próxima que seja a linha", () => {
    const ia = vuln({ id: "AI-1", source: "ai-review", file: "src/a.ts", line: 42 });
    const sast = vuln({ id: "V-1", file: "src/b.ts", line: 42 });
    expect(collidesWithSast(ia, [sast])).toBe(false);
  });

  it("achado da IA sem linha: só colide se o CWE bater", () => {
    const semLinha = vuln({ id: "AI-1", source: "ai-review", line: 0, cwe: "CWE-89" });
    expect(collidesWithSast(semLinha, [vuln({ cwe: "CWE-89", line: 120 })])).toBe(true);
    expect(collidesWithSast(semLinha, [vuln({ cwe: "CWE-79", line: 120 })])).toBe(false);
    expect(collidesWithSast(semLinha, [vuln({ cwe: undefined, line: 120 })])).toBe(false);
  });

  it("compara CWE sem se importar com caixa nem espaço", () => {
    const ia = vuln({ id: "AI-1", source: "ai-review", cwe: " cwe-89 ", line: 40 });
    expect(collidesWithSast(ia, [vuln({ cwe: "CWE-89", line: 41 })])).toBe(true);
  });

  it("separador do Windows não impede o casamento de arquivo", () => {
    const ia = vuln({ id: "AI-1", source: "ai-review", file: "src\\api\\user.ts" });
    expect(collidesWithSast(ia, [vuln({ file: "src/api/user.ts" })])).toBe(true);
  });

  it("lista de SAST vazia: nada colide", () => {
    expect(collidesWithSast(vuln({}), [])).toBe(false);
  });
});

describe("collidesWithSca", () => {
  const dep: DependencyVuln = {
    id: "D-1",
    cve: "CVE-2024-1234",
    package: "lodash",
    installedVersion: "4.17.20",
    fixedVersion: "4.17.21",
    severity: "high",
    title: "t",
    description: "d",
  } as DependencyVuln;

  it("mesmo CVE colide", () => {
    const ia = vuln({ description: "problema com CVE-2024-1234", cwe: undefined });
    expect(collidesWithSca(ia, [dep])).toBe(true);
  });

  it("pacote citado em contexto de dependência colide", () => {
    const ia = vuln({ description: "a versão do lodash está desatualizada" });
    expect(collidesWithSca(ia, [dep])).toBe(true);
  });

  it("achado de CÓDIGO que só menciona o pacote NÃO colide", () => {
    const ia = vuln({ description: "SSRF no fetch construído com lodash.get" });
    expect(collidesWithSca(ia, [dep])).toBe(false);
  });

  it("sem SCA não há colisão", () => {
    expect(collidesWithSca(vuln({}), [])).toBe(false);
  });
});

describe("normPath", () => {
  it("normaliza separador, ./ inicial e caixa", () => {
    expect(normPath(".\\Src\\API\\User.ts")).toBe("src/api/user.ts");
  });

  it("aguenta entrada vazia", () => {
    expect(normPath("")).toBe("");
  });
});
