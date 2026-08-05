// ============================================================
// Exportação dos achados: SARIF 2.1.0, CSV e JSON.
//
// A única saída existente era `window.print()`. Sem exportação não dá para
// levar os achados ao GitHub Code Scanning, ao Jira, a uma planilha ou a um
// pipeline de CI — é o que separa "demo" de "ferramenta adotada".
// Ver AUDITORIA.md#UX-10.
//
// Módulo puro (sem `server-only`, sem banco): recebe o Job já carregado e
// devolve texto. É o que o torna testável sem Postgres.
// ============================================================
import { collidesWithSast } from "./dedup";
import { DEFAULT_LOCALE, type Locale } from "./i18n/config";
import { translate } from "./i18n/translate";
import type { DependencyVuln, Job, Severity, Vulnerability } from "./types";

export type ExportFormat = "sarif" | "csv" | "json";

export function isExportFormat(v: string | null): v is ExportFormat {
  return v === "sarif" || v === "csv" || v === "json";
}

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  // `application/sarif+json` é o tipo registrado; o GitHub aceita ambos.
  sarif: "application/sarif+json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export const FILE_EXT: Record<ExportFormat, string> = {
  sarif: "sarif",
  csv: "csv",
  json: "json",
};

// SARIF só conhece três níveis. "info" vira `note`, não `none`: `none` some da
// interface do Code Scanning.
const SARIF_LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
};

// `security-severity` é numérico (escala CVSS) e é o que o GitHub usa para
// classificar o alerta — sem ele, tudo entra como "warning".
const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: "9.5",
  high: "7.5",
  medium: "5.0",
  low: "3.0",
  info: "1.0",
};

/**
 * Achados de código da análise, já deduplicados (SAST + revisão por IA), na
 * mesma composição que a tela mostra. Exportar um conjunto diferente do que
 * está na tela seria a pior forma de confundir quem usa.
 */
export function collectCodeFindings(job: Job): Vulnerability[] {
  const scan = job.phases.software.result;
  if (!scan) return [];
  const sast = scan.sast.vulnerabilities ?? [];
  const ai = (scan.review?.findings ?? []).filter((f) => !collidesWithSast(f, sast));
  return [...sast, ...ai];
}

export function collectDependencyFindings(job: Job): DependencyVuln[] {
  return job.phases.software.result?.sca.dependencies ?? [];
}

// ------------------------------------------------------------
// SARIF 2.1.0
// ------------------------------------------------------------

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  help: { text: string };
  properties: { tags: string[]; "security-severity": string };
}

/** Uma linha só, sem quebras: `shortDescription` do SARIF não aceita várias. */
function oneLine(s: string, max = 240): string {
  const flat = (s || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * SARIF é indexado por regra: cada `result` aponta para uma entrada em
 * `tool.driver.rules`. Agrupamos por `ruleId` e ficamos com o achado mais
 * grave de cada uma para descrever a regra.
 */
function buildRules(
  findings: Vulnerability[],
  deps: DependencyVuln[],
  locale: Locale
): { rules: SarifRule[]; indexOf: Map<string, number> } {
  const rules: SarifRule[] = [];
  const indexOf = new Map<string, number>();

  const push = (r: SarifRule) => {
    if (indexOf.has(r.id)) return;
    indexOf.set(r.id, rules.length);
    rules.push(r);
  };

  for (const f of findings) {
    const tags = ["security", f.source];
    if (f.cwe) tags.push(f.cwe);
    if (f.owasp) tags.push(f.owasp);
    push({
      id: f.ruleId,
      name: f.ruleId,
      shortDescription: { text: oneLine(f.explain?.title || f.title) },
      fullDescription: {
        text: oneLine(
          f.explain
            ? `${f.explain.whatItIs} ${f.explain.whyItMatters}`
            : f.description,
          1000
        ),
      },
      help: { text: oneLine(f.explain?.howToFix || f.suggestion, 1000) },
      properties: { tags, "security-severity": SECURITY_SEVERITY[f.severity] },
    });
  }

  for (const d of deps) {
    push({
      id: d.cve,
      name: d.cve,
      shortDescription: { text: oneLine(d.explain?.title || d.title) },
      fullDescription: { text: oneLine(d.description, 1000) },
      help: {
        text: oneLine(
          d.explain?.howToFix ||
            (d.fixedVersion
              ? translate(locale, "export.depUpgradeHelp", {
                  pkg: d.package,
                  version: d.fixedVersion,
                })
              : translate(locale, "export.depNoFixHelp", { pkg: d.package })),
          1000
        ),
      },
      properties: {
        tags: ["security", "sca", "dependency"],
        "security-severity": SECURITY_SEVERITY[d.severity],
      },
    });
  }

  return { rules, indexOf };
}

/** Caminho relativo, com "/" — é o que o SARIF exige em `artifactLocation.uri`. */
function sarifUri(file: string): string {
  return (file || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function toSarif(job: Job, locale: Locale = DEFAULT_LOCALE): string {
  const findings = collectCodeFindings(job);
  const deps = collectDependencyFindings(job);
  const { rules, indexOf } = buildRules(findings, deps, locale);

  const results = [
    ...findings.map((f) => ({
      ruleId: f.ruleId,
      ruleIndex: indexOf.get(f.ruleId),
      level: SARIF_LEVEL[f.severity],
      message: { text: oneLine(f.explain?.whatItIs || f.description || f.title, 1000) },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: sarifUri(f.file) },
            // SARIF conta a partir de 1; linha 0 significa "não localizado".
            region:
              f.line > 0
                ? { startLine: f.line, ...(f.endLine && f.endLine > f.line ? { endLine: f.endLine } : {}) }
                : { startLine: 1 },
          },
        },
      ],
      // Sem isto o Code Scanning reabre todo achado a cada push, porque o
      // número da linha muda. A impressão digital do StarGuard é justamente o
      // identificador estável (FEAT-01).
      partialFingerprints: { starguardFingerprint: `${f.ruleId}:${sarifUri(f.file)}` },
      properties: {
        severity: f.severity,
        source: f.source,
        ...(f.confidence ? { confidence: f.confidence } : {}),
      },
    })),
    ...deps.map((d) => ({
      ruleId: d.cve,
      ruleIndex: indexOf.get(d.cve),
      level: SARIF_LEVEL[d.severity],
      message: {
        text: oneLine(
          `${d.package} ${d.installedVersion}: ${d.title}${
            d.fixedVersion ? ` (corrigido em ${d.fixedVersion})` : ""
          }`,
          1000
        ),
      },
      // O SCA não sabe o arquivo do manifesto; sem localização o GitHub
      // descarta o resultado, então apontamos para a raiz do repositório.
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "." },
            region: { startLine: 1 },
          },
        },
      ],
      partialFingerprints: { starguardFingerprint: `${d.cve}:${d.package}` },
      properties: { severity: d.severity, source: "sca", package: d.package },
    })),
  ];

  return JSON.stringify(
    {
      $schema:
        "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "StarGuard",
              informationUri: "https://github.com/starbridge/starguard",
              rules,
            },
          },
          automationDetails: { id: `starguard/${job.id}` },
          results,
        },
      ],
    },
    null,
    2
  );
}

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------

// Quem abre o CSV é uma PESSOA, no Excel — o cabeçalho segue o idioma dela.
// O JSON não: aquele é contrato de máquina e mantém as chaves estáveis.
const CSV_COLS = [
  "csv.id",
  "csv.source",
  "csv.severity",
  "csv.rule",
  "csv.cwe",
  "csv.owasp",
  "csv.file",
  "csv.line",
  "csv.title",
  "csv.description",
  "csv.howToFix",
] as const;

function csvHeader(locale: Locale): string[] {
  return CSV_COLS.map((c) => translate(locale, c));
}

/**
 * Escapa um campo de CSV.
 *
 * O prefixo com aspa simples em `=`, `+`, `-` e `@` não é frescura: o Excel
 * interpreta uma célula iniciada por esses caracteres como fórmula, e o texto
 * aqui vem de um repositório de terceiros (injeção de fórmula em CSV).
 */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  s = s.replace(/\r?\n/g, " ").trim();
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(job: Job, locale: Locale = DEFAULT_LOCALE): string {
  const rows: string[][] = [];

  for (const f of collectCodeFindings(job)) {
    rows.push([
      f.id,
      f.source,
      f.severity,
      f.ruleId,
      f.cwe ?? "",
      f.owasp ?? "",
      f.file,
      f.line > 0 ? String(f.line) : "",
      f.explain?.title || f.title,
      f.explain ? `${f.explain.whatItIs} ${f.explain.whyItMatters}` : f.description,
      f.explain?.howToFix || f.suggestion,
    ]);
  }

  for (const d of collectDependencyFindings(job)) {
    rows.push([
      d.id,
      "sca",
      d.severity,
      d.cve,
      "",
      "",
      `${d.package}@${d.installedVersion}`,
      "",
      d.explain?.title || d.title,
      d.description,
      d.explain?.howToFix ||
        (d.fixedVersion
          ? translate(locale, "export.depUpgradeTo", { version: d.fixedVersion })
          : translate(locale, "export.depNoFix")),
    ]);
  }

  // BOM na frente: sem ele o Excel abre UTF-8 como Latin-1 e "injeção" vira
  // "injeÃ§Ã£o". É o formato que mais vai parar numa planilha.
  return (
    "﻿" +
    [csvHeader(locale), ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

// ------------------------------------------------------------
// JSON
// ------------------------------------------------------------

export function toJson(job: Job): string {
  return JSON.stringify(
    {
      analysisId: job.id,
      project: job.input.projectName,
      repoUrl: job.input.repoUrl ?? null,
      createdAt: new Date(job.createdAt).toISOString(),
      exportedAt: new Date().toISOString(),
      engines: {
        sast: job.phases.software.result?.sast.engine ?? null,
        sca: job.phases.software.result?.sca.engine ?? null,
        review: job.phases.software.result?.review?.engine ?? null,
      },
      // `ran` distingue "nada encontrado" de "nada foi procurado" — a mesma
      // honestidade que a tela mostra (UX-15) precisa sobreviver à exportação.
      coverage: {
        sastRan: job.phases.software.result?.sast.ran ?? false,
        scaRan: job.phases.software.result?.sca.ran ?? false,
        reviewRan: job.phases.software.result?.review?.ran ?? false,
      },
      findings: collectCodeFindings(job),
      dependencies: collectDependencyFindings(job),
    },
    null,
    2
  );
}

export function exportAnalysis(
  job: Job,
  format: ExportFormat,
  locale: Locale = DEFAULT_LOCALE
): string {
  if (format === "sarif") return toSarif(job, locale);
  if (format === "csv") return toCsv(job, locale);
  // JSON é dado bruto para pipeline: as chaves NÃO seguem o idioma, senão
  // trocar de idioma quebraria o consumidor do outro lado.
  return toJson(job);
}

/** Nome de arquivo seguro para o `Content-Disposition`. */
export function exportFilename(job: Job, format: ExportFormat): string {
  const slug =
    (job.input.projectName || "analise")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // marcas de acento separadas pelo NFD
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "analise";
  return `starguard-${slug}-${job.id.slice(0, 8)}.${FILE_EXT[format]}`;
}
