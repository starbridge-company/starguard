// ============================================================
// Do achado ao Pull Request de correções.
//
// Duas responsabilidades, e a primeira é a que controla a conta do mês:
//
//  1. **Filtrar pelo diff.** Os scanners rodaram no repositório inteiro (é
//     barato); a IA da correção só olha o que mudou. Sem esse filtro, cada
//     commit numa base grande geraria dezenas de chamadas de correção sobre
//     código que ninguém tocou.
//  2. **Abrir UM PR** com todas as correções, separado do commit original.
//     Ninguém tem código alterado por baixo — quem revisa decide.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import type { AnalysisRun, FixableFinding } from "@starguard/core/contracts";
import type { DependencyVuln, Severity, Vulnerability } from "@/types";
import { getAnalyzer } from "@starguard/core/registry";
import { openWorkspace } from "@starguard/core/workspace";
import { openPullRequestBatch } from "@starguard/core/git";
import { log } from "@starguard/core/logger";
import { normPath } from "@starguard/core/dedup";

/**
 * Quantos achados corrigir por execução.
 *
 * Não é limitação técnica: é freio de custo e de revisão. Um PR com quarenta
 * correções geradas por IA não é revisado — é aprovado no escuro ou ignorado,
 * e os dois desfechos são piores que corrigir menos. O teto é por env para
 * quem quiser ajustar sabendo o que está trocando.
 */
const MAX_CORRECOES = Number(process.env.WEBHOOK_MAX_FIXES || 5);

/** Só isto ou pior vira correção automática. */
const SEVERIDADE_MINIMA: Severity = (process.env.WEBHOOK_MIN_SEVERITY as Severity) || "high";

const PESO: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export interface AchadoParaCorrigir extends FixableFinding {
  severity: Severity;
}

/**
 * Achados que caem em arquivo ALTERADO e são graves o bastante.
 *
 * A comparação normaliza a barra: o scanner pode devolver `src\\app.ts` no
 * Windows e a API do GitHub sempre devolve `src/app.ts`. Sem normalizar, o
 * filtro descartaria tudo em silêncio — e o sintoma seria "o bot nunca abre
 * PR", que é difícil de rastrear até aqui.
 */
export function achadosNoDiff(run: AnalysisRun, alterados: string[]): AchadoParaCorrigir[] {
  const mudou = new Set(alterados.map(normPath));
  const out: AchadoParaCorrigir[] = [];

  const deCodigo = (v: Vulnerability, analyzer: "sast" | "business") => {
    if (!mudou.has(normPath(v.file))) return;
    out.push({
      id: v.id,
      analyzer,
      ruleId: v.ruleId,
      title: v.explain?.title || v.title,
      severity: v.severity,
      file: v.file,
      line: v.line,
      endLine: v.endLine,
      description: v.explain?.whatItIs || v.description,
      suggestion: v.suggestion,
      codeSnippet: v.codeSnippet,
      cwe: v.cwe,
      raw: v,
    });
  };

  for (const v of (run.outcomes.sast?.result as Vulnerability[] | undefined) ?? []) {
    deCodigo(v, "sast");
  }
  const review = run.outcomes.business?.result as { findings?: Vulnerability[] } | undefined;
  for (const v of review?.findings ?? []) deCodigo(v, "business");

  for (const d of (run.outcomes.sca?.result as DependencyVuln[] | undefined) ?? []) {
    // Dependência é caso à parte: o manifesto quase nunca está no diff, mas um
    // CVE novo numa dependência é justamente o que se quer pegar. Entra sempre
    // que houver versão corrigida — a correção é determinística e não custa
    // julgamento.
    if (!d.fixedVersion || !d.manifest) continue;
    out.push({
      id: d.id,
      analyzer: "sca",
      ruleId: d.cve,
      title: `${d.package} ${d.installedVersion} → ${d.fixedVersion}`,
      severity: d.severity,
      file: d.manifest,
      description: d.explain?.whatItIs || d.description || d.title,
      raw: d,
    });
  }

  return out
    .filter((a) => PESO[a.severity] <= PESO[SEVERIDADE_MINIMA])
    .sort((a, b) => PESO[a.severity] - PESO[b.severity])
    .slice(0, MAX_CORRECOES);
}

export interface AbrirPrInput {
  repo: string;
  token: string;
  dir: string;
  baseRef: string;
  achados: AchadoParaCorrigir[];
  /** "PR #12" ou "commit abc1234" — entra no corpo do PR. */
  origem: string;
}

export interface PrAberto {
  number: number;
  url: string;
}

/**
 * Gera as correções e abre UM Pull Request com todas.
 *
 * Um PR e não um por achado: quem recebe cinco PRs do bot no mesmo dia fecha
 * todos sem ler. E as correções são geradas em SEQUÊNCIA, não em paralelo —
 * duas correções no mesmo arquivo partiriam do mesmo original e a última
 * apagaria a primeira, que é exatamente o AUDITORIA.md#BUG-06.
 */
export async function abrirPrDeCorrecoes(input: AbrirPrInput): Promise<PrAberto | null> {
  const ws = await openWorkspace({ type: "local", path: input.dir });
  if (!ws) return null;

  const arquivos = new Map<string, string>();
  const explicacoes: string[] = [];

  try {
    for (const achado of input.achados) {
      const fixer = getAnalyzer(achado.analyzer)?.fix;
      if (!fixer) continue;

      const pode = fixer.can(achado);
      if (!pode.ok) continue;

      try {
        const proposta = await fixer.propose(achado, {
          workspace: ws,
          locale: "pt-BR",
          // Sem `repoUrl`: há código EM DISCO, e passá-lo faria o engine de
          // agente clonar de novo do GitHub. Ver a nota em `fix/code-fixer.ts`.
          baseCode: arquivos.get(normPath(achado.file)),
        });
        if (proposta.noChange) continue;

        for (const mudanca of proposta.changes) {
          // O resultado alimenta a PRÓXIMA correção do mesmo arquivo, via
          // `baseCode`: sem isso, a segunda partiria do original e desfaria a
          // primeira (BUG-06).
          arquivos.set(normPath(mudanca.file), mudanca.fixedCode);
        }
        explicacoes.push(
          `- **${achado.file}${achado.line ? `:${achado.line}` : ""}** — ${achado.title}\n  ${proposta.explanation}`
        );
      } catch (e) {
        // Uma correção que falha não pode derrubar as outras: o PR sai com o
        // que deu certo, e o que faltou continua visível no painel.
        log.warn("fixpr.propose.failed", { engine: achado.id, error: e });
      }
    }

    if (!arquivos.size) return null;

    const pr = await openPullRequestBatch({
      repoUrl: `https://github.com/${input.repo}`,
      files: [...arquivos.entries()].map(([file, fixedCode]) => ({ file, fixedCode })),
      title: `fix(security): ${input.achados.length} correção(ões) automática(s)`,
      body: corpoDoPr(input, explicacoes),
      token: input.token,
    });

    return { number: pr.number, url: pr.url };
  } finally {
    await ws.dispose();
  }
}

/**
 * O corpo do PR.
 *
 * Diz de onde veio, o que mudou e — a parte que não pode faltar — que o
 * conteúdo foi gerado por IA e precisa de revisão. Um PR automático que se
 * apresenta como veredito seria pior que nenhum.
 */
function corpoDoPr(input: AbrirPrInput, explicacoes: string[]): string {
  return [
    `Correções de segurança propostas automaticamente pelo **StarGuard**, a partir de ${input.origem}.`,
    "",
    "## O que mudou",
    "",
    ...explicacoes,
    "",
    "---",
    "",
    "> ⚠️ **Gerado por IA — revise antes de aprovar.** As alterações foram",
    "> produzidas por modelo a partir do contexto de cada achado. Elas não",
    "> substituem revisão humana, e o StarGuard não executou os testes deste",
    "> repositório.",
    "",
    "> Se alguma correção mexeu num manifesto de dependência, o **lockfile não",
    "> foi regerado** — rode o instalador do seu ecossistema antes de mesclar.",
  ].join("\n");
}
