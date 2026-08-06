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
  SkillValidation,
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

  // As skills entram na LISTA, e não no painel Problemas — AUDITORIA.md#UX-24.
  //
  // A primeira versão as deixava de fora dos dois, e o efeito era o pior
  // possível: rodar o analisador de skills sobre um prompt com injeção
  // terminava com o painel dizendo "nada encontrado". Achado real, reportado
  // como limpo. O terminal já tinha passado por isto (`render.ts`), e a
  // correção lá foi a mesma.
  //
  // O que continua valendo é a decisão sobre os DIAGNÓSTICOS: a posição do
  // achado é dentro do texto analisado, que pode não ser o arquivo aberto no
  // editor. Sublinhar a linha 12 do arquivo errado é pior que não sublinhar —
  // quem publica os diagnósticos filtra `skills` fora.
  const skills = run.outcomes.skills?.result as SkillValidation[] | undefined;
  for (const s of skills ?? []) {
    for (const f of s.findings) {
      out.push({
        id: f.id,
        analyzer: "skills",
        severity: f.severity,
        ruleId: f.type,
        title: f.title,
        file: s.skillName,
        line: f.line,
        description: f.description,
        suggestion: f.recommendation,
        codeSnippet: f.snippet,
        raw: f,
      });
    }
  }

  return out.sort((a, b) => PESO[a.severity] - PESO[b.severity]);
}

/**
 * Vai para o painel Problemas?
 *
 * Só o que tem arquivo e linha de VERDADE no workspace. Ver o comentário
 * acima: a skill é texto, não posição em arquivo do projeto.
 */
export function ehDiagnostico(a: Achado): boolean {
  return a.analyzer !== "skills";
}

/**
 * A identidade de um achado dentro da extensão.
 *
 * O mesmo achado atravessa três formatos: `Achado` (a lista e os
 * diagnósticos), `FixableFinding` (o que o corretor recebe) e uma string solta
 * no `arguments` da CodeAction. Esta chave é o que os costura — e é por ela que
 * um achado corrigido é reencontrado para sair da tela.
 *
 * UMA função, com um parâmetro estrutural, e não uma por formato: enquanto
 * eram duas, nada obrigava as duas a produzirem o mesmo texto. Bastava alguém
 * mexer em uma para a correção passar a "aplicar" sem tirar nada da lista — sem
 * erro nenhum, porque procurar uma chave que não existe devolve `undefined`,
 * que aqui parece "não havia nada a remover".
 *
 * Os dois padrões existem porque os dois campos são opcionais de um lado:
 * dependência não tem linha (o achado do Trivy aponta o manifesto inteiro) e
 * `FixableFinding.ruleId` é opcional no contrato do núcleo. Sem eles a chave
 * sairia com `undefined` no meio — e `undefined` de um lado contra o valor do
 * outro é justamente a divergência silenciosa que esta função existe para
 * impedir.
 */
export function chaveDoAchado(a: {
  analyzer: AnalyzerId;
  file: string;
  line?: number;
  ruleId?: string;
}): string {
  return `${a.analyzer}|${a.file}|${a.line ?? 0}|${a.ruleId ?? ""}`;
}
