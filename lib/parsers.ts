// ============================================================
// Parsers dos outputs das ferramentas (Semgrep/Opengrep, Trivy) -> tipos StarGuard.
// ============================================================
import type { Severity, Vulnerability, DependencyVuln } from "@/types";
import { FIX_GUIDE } from "@/lib/constants";

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
      suggestion: FIX_GUIDE,
      cwe: Array.isArray(cwe) ? cwe[0] : cwe,
      owasp: Array.isArray(owasp) ? owasp[0] : owasp,
    };
  });
}

interface TrivyRaw {
  Results?: Array<{
    /** Arquivo onde a dependência foi declarada (ex.: "package-lock.json"). */
    Target?: string;
    /** Ecossistema: "npm", "pip", "gomod", "maven"… */
    Type?: string;
    Vulnerabilities?: Array<{
      VulnerabilityID?: string;
      PkgName?: string;
      InstalledVersion?: string;
      FixedVersion?: string;
      Severity?: string;
      Title?: string;
      Description?: string;
      /** Caminho do manifesto quando difere do Target (monorepo, workspace). */
      PkgPath?: string;
    }>;
  }>;
}

/**
 * O Trivy aponta o LOCKFILE (`package-lock.json`), não o manifesto que se
 * edita à mão. Corrigir uma dependência é mexer no manifesto e regerar o
 * lock — então guardamos o palpite do manifesto ao lado do alvo original.
 */
const MANIFEST_BY_LOCK: Record<string, string> = {
  "package-lock.json": "package.json",
  "yarn.lock": "package.json",
  "pnpm-lock.yaml": "package.json",
  "poetry.lock": "pyproject.toml",
  "Pipfile.lock": "Pipfile",
  "Gemfile.lock": "Gemfile",
  "composer.lock": "composer.json",
  "Cargo.lock": "Cargo.toml",
  "go.sum": "go.mod",
};

export function manifestForTarget(target?: string): string | undefined {
  if (!target) return undefined;
  const norm = target.replace(/\\/g, "/");
  const base = norm.split("/").pop() || norm;
  const mapped = MANIFEST_BY_LOCK[base];
  if (!mapped) return norm; // já é um manifesto (requirements.txt, go.mod…)
  const dir = norm.slice(0, norm.length - base.length);
  return `${dir}${mapped}`;
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
        // Onde a dependência vive: sem isto não dá para corrigir, só relatar.
        lockfile: res.Target,
        manifest: manifestForTarget(v.PkgPath || res.Target),
        ecosystem: res.Type,
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
