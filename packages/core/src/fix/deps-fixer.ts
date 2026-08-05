// ============================================================
// O `Fixer` do analisador de DEPENDÊNCIAS.
//
// Corrigir dependência é diferente de corrigir código, e por isso tem corretor
// próprio: o QUE fazer já é conhecido — o Trivy diz o pacote e a versão que
// corrige. Não há dúvida a resolver com IA sobre o alvo. O que exige olhar o
// repositório é ONDE mexer: a declaração pode estar com faixa (`^`, `~`), num
// workspace de monorepo, ou nem existir no manifesto (dependência transitiva,
// que precisa de override).
//
// Daí o desenho: o alvo sai daqui de graça e determinístico; a IA entra só
// para localizar e editar.
//
// O `followUp` é a parte que não pode faltar. O corretor edita o manifesto e
// NÃO regera o lockfile — um PR com manifesto novo e lock velho quebra o
// `npm ci` de quem recebe. O aviso viaja com a proposta, em chave traduzível,
// para sair certo na tela, no terminal e no corpo do Pull Request.
// NODE-ONLY.
// ============================================================
import type {
  FixContext,
  FixEligibility,
  FixProposal,
  FixableFinding,
  Fixer,
  Workspace,
} from "../contracts";
import type { DependencyVuln } from "../types";
import { generateFix } from "./code";
import {
  buildDependencyFixPrompt,
  canFixDependency,
  lockCommandFor,
  lockfileWarning,
  whyCannotFix,
} from "./deps";

/** O achado carrega a dependência original em `raw` — quem a colocou lá foi o analisador. */
function depOf(f: FixableFinding): DependencyVuln | null {
  const raw = f.raw as DependencyVuln | undefined;
  return raw && typeof raw === "object" && "package" in raw ? raw : null;
}

export function makeDepsFixer(): Fixer {
  return {
    can(finding: FixableFinding): FixEligibility {
      const dep = depOf(finding);
      if (!dep) return { ok: false, reasonKey: "fix.cannot.noFile" };
      const motivo = whyCannotFix(dep);
      // Os dois motivos são exibidos, não engolidos: sem versão corrigida o
      // upstream simplesmente não publicou correção, e desabilitar o botão sem
      // dizer isso faria parecer defeito da ferramenta.
      if (motivo === "no_fixed_version") {
        return { ok: false, reasonKey: "deps.noFixedVersion" };
      }
      if (motivo === "no_manifest") return { ok: false, reasonKey: "deps.noManifest" };
      return canFixDependency(dep) ? { ok: true } : { ok: false, reasonKey: "deps.noManifest" };
    },

    async propose(finding, ctx: FixContext): Promise<FixProposal> {
      const dep = depOf(finding);
      if (!dep) throw new Error("Achado de dependência sem os dados do pacote.");

      const manifest = dep.manifest!;
      const r = await generateFix({
        vulnerabilityId: dep.id,
        file: manifest,
        originalCode: "",
        description: `${dep.cve} — ${dep.title}`,
        // O alvo é determinístico e vai como instrução; a IA só localiza e edita.
        suggestion: buildDependencyFixPrompt(dep),
        line: 1,
        ruleId: dep.cve,
        // Mesma regra do corretor de código: havendo manifesto em disco, é ele
        // que se edita. Ver a nota em `code-fixer.ts`.
        repoUrl: ctx.workspace?.kind === "local" ? undefined : ctx.repoUrl,
        token: ctx.token,
        workspaceRoot: ctx.workspace?.kind === "local" ? ctx.workspace.root : undefined,
        userInstructions: ctx.userInstructions,
        locale: ctx.locale,
      });

      const aviso = lockfileWarning(dep);
      return {
        findingId: finding.id,
        file: r.file,
        changes: [
          { file: r.file, originalCode: r.originalCode, fixedCode: r.fixedCode },
        ],
        explanation: r.explanation,
        engine: r.engine === "agent" ? "agent" : "api",
        noChange: !!r.noChange,
        followUp: aviso
          ? [{ commandKey: aviso.key, command: lockCommandFor(dep) }]
          : undefined,
      };
    },

    async apply(proposal: FixProposal, ws: Workspace): Promise<void> {
      for (const c of proposal.changes) {
        if (c.fixedCode === c.originalCode) continue;
        await ws.writeFile(c.file, c.fixedCode);
      }
    },
  };
}
