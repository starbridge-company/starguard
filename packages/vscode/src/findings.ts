// ============================================================
// Achatamento dos resultados para o painel Problemas.
//
// O orquestrador devolve cada analisador com o SEU formato — `Vulnerability[]`
// do SAST, `DependencyVuln[]` do Trivy, uma seção com `findings` da revisão
// por IA. O editor precisa de uma coisa só: arquivo, linha, severidade,
// mensagem.
//
// Mora aqui, e não no núcleo, porque é forma de APRESENTAÇÃO. O núcleo entrega
// o dado do jeito que cada ferramenta produz; quem decide como exibir é cada
// interface — o terminal tem o seu equivalente em `packages/cli/src/render.ts`.
// ============================================================
import type { AnalysisRun } from "@starguard/core/contracts";
import type {
  AnalyzerId,
  DependencyVuln,
  Severity,
  Vulnerability,
} from "@starguard/core/types";

export interface Achado {
  id: string;
  analyzer: AnalyzerId;
  severity: Severity;
  ruleId: string;
  title: string;
  file: string;
  line?: number;
  endLine?: number;
  description: string;
  suggestion?: string;
  codeSnippet?: string;
  cwe?: string;
  /** Payload original — o `Fixer` do analisador sabe o que é. */
  raw: unknown;
}

const PESO: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function achadosDe(run: AnalysisRun): Achado[] {
  const out: Achado[] = [];

  const deCodigo = (v: Vulnerability, analyzer: AnalyzerId): Achado => ({
    id: v.id,
    analyzer,
    severity: v.severity,
    ruleId: v.ruleId,
    // O título enriquecido já vem no idioma de quem configurou a extensão; o
    // do scanner vem em inglês. Preferir o primeiro é metade do valor do
    // enriquecimento (AUDITORIA.md#FEAT-03).
    title: v.explain?.title || v.title,
    file: v.file,
    line: v.line,
    endLine: v.endLine,
    description: v.explain?.whatItIs || v.description,
    suggestion: v.suggestion,
    codeSnippet: v.codeSnippet,
    cwe: v.cwe,
    raw: v,
  });

  for (const v of (run.outcomes.sast?.result as Vulnerability[] | undefined) ?? []) {
    out.push(deCodigo(v, "sast"));
  }

  const review = run.outcomes.business?.result as { findings?: Vulnerability[] } | undefined;
  for (const v of review?.findings ?? []) {
    out.push(deCodigo(v, "business"));
  }

  for (const d of (run.outcomes.sca?.result as DependencyVuln[] | undefined) ?? []) {
    out.push({
      id: d.id,
      analyzer: "sca",
      severity: d.severity,
      ruleId: d.cve,
      title: `${d.package} ${d.installedVersion}${d.fixedVersion ? ` → ${d.fixedVersion}` : ""}`,
      // O MANIFESTO, não o lockfile que o scanner leu: é o arquivo que a
      // pessoa abre e onde a correção mexe. Apontar para o lock levaria o
      // clique do painel Problemas a um arquivo gerado.
      file: d.manifest || d.lockfile || "package.json",
      // Dependência não tem linha própria; sem `line`, o diagnóstico marca a
      // primeira, que é onde o manifesto começa.
      description: d.explain?.whatItIs || d.description || d.title,
      raw: d,
    });
  }

  // As skills não entram no painel Problemas: o achado é sobre o TEXTO de um
  // prompt, e as heurísticas dão a posição dentro do conteúdo analisado, que
  // pode não ser o arquivo aberto. Sai no canal de saída, onde não finge uma
  // precisão que não tem.

  return out.sort((a, b) => PESO[a.severity] - PESO[b.severity]);
}
