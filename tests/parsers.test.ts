import { describe, it, expect } from "vitest";
import { parseSemgrep, parseTrivy } from "@starguard/core/parsers";

describe("parseSemgrep", () => {
  it("mapeia o achado e encurta o id da regra", () => {
    const [v] = parseSemgrep({
      results: [
        {
          check_id: "opt.opengrep-rules.javascript.lang.security.detect-child-process",
          path: "src/api/ping.js",
          start: { line: 12 },
          end: { line: 14 },
          extra: {
            message: "Detected child_process",
            severity: "ERROR",
            lines: 'exec("ping " + host)',
            metadata: { cwe: ["CWE-78: OS Command Injection"], owasp: "A03" },
          },
        },
      ],
    });
    expect(v).toMatchObject({
      id: "V-1",
      source: "sast",
      ruleId: "detect-child-process", // não o caminho inteiro
      severity: "critical", // ERROR -> critical
      file: "src/api/ping.js",
      line: 12,
      endLine: 14,
      cwe: "CWE-78: OS Command Injection", // array -> primeiro item
      owasp: "A03",
    });
  });

  it("aguenta campos ausentes sem quebrar", () => {
    const [v] = parseSemgrep({ results: [{}] });
    expect(v.file).toBe("desconhecido");
    expect(v.line).toBe(0);
    // Severidade desconhecida cai em "medium" — conservador de propósito:
    // subestimar um achado é pior que superestimar.
    expect(v.severity).toBe("medium");
  });

  it("entrada vazia devolve lista vazia", () => {
    expect(parseSemgrep({})).toEqual([]);
    expect(parseSemgrep({ results: [] })).toEqual([]);
  });

  it("numera sequencialmente", () => {
    const vs = parseSemgrep({ results: [{}, {}, {}] });
    expect(vs.map((v) => v.id)).toEqual(["V-1", "V-2", "V-3"]);
  });
});

describe("parseTrivy", () => {
  it("achata os resultados e mapeia a severidade", () => {
    const deps = parseTrivy({
      Results: [
        {
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2019-10744",
              PkgName: "lodash",
              InstalledVersion: "4.17.4",
              FixedVersion: "4.17.12",
              Severity: "CRITICAL",
              Title: "Prototype pollution",
            },
          ],
        },
        { Vulnerabilities: [{ VulnerabilityID: "CVE-X", Severity: "LOW" }] },
      ],
    });
    expect(deps).toHaveLength(2);
    expect(deps[0]).toMatchObject({
      id: "D-1",
      source: "sca",
      package: "lodash",
      cve: "CVE-2019-10744",
      fixedVersion: "4.17.12",
      severity: "critical",
    });
    expect(deps[1]?.severity).toBe("low");
  });

  it("resultado sem vulnerabilidade devolve lista vazia", () => {
    expect(parseTrivy({ Results: [{}] })).toEqual([]);
    expect(parseTrivy({})).toEqual([]);
  });
});
