// ============================================================
// Parsers dos outputs das ferramentas (Semgrep/Opengrep, Trivy) -> tipos StarGuard.
// ============================================================
import type { Severity, Vulnerability, DependencyVuln } from "@/types";

// Regras locais fazem o check_id virar o caminho completo com pontos
// (ex.: "C.Users.Nelson.bin.opengrep-rules.javascript...detect-child-process").
// Mantém só o nome final da regra para exibir de forma limpa.
function shortRuleId(id: string | undefined): string {
  if (!id) return "regra-desconhecida";
  const seg = id.split(/[.\\/]/).filter(Boolean).pop();
  return seg || id;
}

function mapSemgrepSeverity(s: string | undefined): Severity {
  switch ((s || "").toUpperCase()) {
    case "ERROR":
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "WARNING":
    case "MEDIUM":
      return "medium";
    case "INFO":
    case "LOW":
      return "low";
    default:
      return "medium";
  }
}

function mapTrivySeverity(s: string | undefined): Severity {
  switch ((s || "").toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "info";
  }
}

interface SemgrepRaw {
  results?: Array<{
    check_id?: string;
    path?: string;
    start?: { line?: number };
    end?: { line?: number };
    extra?: {
      message?: string;
      severity?: string;
      lines?: string;
      metadata?: { cwe?: string | string[]; owasp?: string | string[] };
    };
  }>;
}

export function parseSemgrep(json: SemgrepRaw): Vulnerability[] {
  const results = json.results || [];
  return results.map((r, i) => {
    const cwe = r.extra?.metadata?.cwe;
    const owasp = r.extra?.metadata?.owasp;
    return {
      id: `V-${i + 1}`,
      source: "sast",
      ruleId: shortRuleId(r.check_id),
      title: (r.extra?.message || r.check_id || "Achado SAST").slice(0, 140),
      severity: mapSemgrepSeverity(r.extra?.severity),
      file: r.path || "desconhecido",
      line: r.start?.line ?? 0,
      endLine: r.end?.line,
      description: r.extra?.message || "",
      codeSnippet: r.extra?.lines,
      suggestion:
        "Corrija apenas este problema de segurança, sem alterar a lógica de negócio, mantendo o estilo e a indentação do arquivo.",
      cwe: Array.isArray(cwe) ? cwe[0] : cwe,
      owasp: Array.isArray(owasp) ? owasp[0] : owasp,
    };
  });
}

interface TrivyRaw {
  Results?: Array<{
    Vulnerabilities?: Array<{
      VulnerabilityID?: string;
      PkgName?: string;
      InstalledVersion?: string;
      FixedVersion?: string;
      Severity?: string;
      Title?: string;
      Description?: string;
    }>;
  }>;
}

export function parseTrivy(json: TrivyRaw): DependencyVuln[] {
  const out: DependencyVuln[] = [];
  for (const res of json.Results || []) {
    for (const v of res.Vulnerabilities || []) {
      out.push({
        id: `D-${out.length + 1}`,
        source: "sca",
        package: v.PkgName || "desconhecido",
        installedVersion: v.InstalledVersion || "?",
        fixedVersion: v.FixedVersion,
        severity: mapTrivySeverity(v.Severity),
        cve: v.VulnerabilityID || "CVE-desconhecido",
        title: (v.Title || v.VulnerabilityID || "Dependência vulnerável").slice(
          0,
          160
        ),
        description: v.Description || "",
      });
    }
  }
  return out;
}
