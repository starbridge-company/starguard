import { describe, it, expect } from "vitest";
import {
  vulnerabilityFingerprint,
  dependencyFingerprint,
} from "@starguard/core/fingerprint";
import type { Vulnerability, DependencyVuln } from "@/types";

const base: Vulnerability = {
  id: "V-1",
  source: "sast",
  ruleId: "detect-child-process",
  title: "Command execution",
  severity: "high",
  file: "src/api/ping.js",
  line: 42,
  description: "…",
  codeSnippet: 'exec("ping " + host)',
  suggestion: "…",
};

// AUDITORIA.md#FEAT-01 — é a impressão digital que faz o estado "já corrigi"
// atravessar análises. Se ela mudar por motivo errado, o histórico corrompe.
describe("fingerprint · FEAT-01", () => {
  it("é estável entre execuções", () => {
    expect(vulnerabilityFingerprint(base)).toBe(vulnerabilityFingerprint({ ...base }));
  });

  it("NÃO muda quando a linha se desloca", () => {
    // Editar código acima do achado não pode ressuscitar algo já resolvido.
    expect(vulnerabilityFingerprint({ ...base, line: 907 })).toBe(
      vulnerabilityFingerprint(base)
    );
  });

  it("NÃO muda com reindentação do trecho", () => {
    expect(
      vulnerabilityFingerprint({
        ...base,
        codeSnippet: '    exec("ping " + host)   ',
      })
    ).toBe(vulnerabilityFingerprint(base));
  });

  it("NÃO muda com separador de caminho do Windows", () => {
    expect(
      vulnerabilityFingerprint({ ...base, file: "src\\api\\ping.js" })
    ).toBe(vulnerabilityFingerprint(base));
  });

  it("MUDA quando é outro arquivo", () => {
    expect(vulnerabilityFingerprint({ ...base, file: "src/api/outro.js" })).not.toBe(
      vulnerabilityFingerprint(base)
    );
  });

  it("MUDA quando é outra regra", () => {
    expect(vulnerabilityFingerprint({ ...base, ruleId: "detect-eval" })).not.toBe(
      vulnerabilityFingerprint(base)
    );
  });

  it("MUDA quando o código vulnerável é outro", () => {
    expect(
      vulnerabilityFingerprint({ ...base, codeSnippet: 'exec("ls " + dir)' })
    ).not.toBe(vulnerabilityFingerprint(base));
  });

  it("dependência: identidade é pacote + CVE", () => {
    const d: DependencyVuln = {
      id: "D-1",
      source: "sca",
      package: "lodash",
      installedVersion: "4.17.4",
      severity: "critical",
      cve: "CVE-2019-10744",
      title: "…",
      description: "…",
    };
    // A versão instalada muda a cada bump; a identidade do achado não.
    expect(dependencyFingerprint({ ...d, installedVersion: "4.17.5" })).toBe(
      dependencyFingerprint(d)
    );
    expect(dependencyFingerprint({ ...d, cve: "CVE-2020-8203" })).not.toBe(
      dependencyFingerprint(d)
    );
  });
});
