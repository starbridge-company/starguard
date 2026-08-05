// ============================================================
// O `Fixer` de quem corrige ARQUIVO-FONTE.
//
// Dois analisadores corrigem código: o de vulnerabilidades (`sast`) e o de
// regras de negócio (`business`). O contrato manda a correção morar dentro da
// ferramenta que achou o problema — e mora: cada um exporta o seu `fix`. O que
// eles não precisam é ter duas cópias do mesmo motor, então ele está aqui e os
// dois o instanciam.
//
// A divisão `propose` / `apply` é a razão de existir deste arquivo. Antes, a
// única função disponível gerava a correção e quem chamasse decidia o que
// fazer com ela; agora `propose` é garantidamente sem efeito colateral (dá
// para chamar do modal, do `--dry-run` e do lightbulb do editor sem medo) e
// `apply` é o único ponto que escreve. NODE-ONLY.
// ============================================================
import type {
  FixContext,
  FixEligibility,
  FixProposal,
  FixableFinding,
  Fixer,
  Workspace,
} from "../contracts";
import { generateFix, type ExtraFinding, type FixInput } from "./code";

function toExtra(f: FixableFinding): ExtraFinding {
  return {
    vulnerabilityId: f.id,
    description: f.description,
    suggestion: f.suggestion,
    line: f.line,
    endLine: f.endLine,
    cwe: f.cwe,
    owasp: f.owasp,
    ruleId: f.ruleId,
  };
}

/** Extensão -> linguagem, só para orientar o prompt e o realce do diff. */
function languageOf(file: string): string | undefined {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  const MAPA: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".cs": "csharp",
    ".rs": "rust",
    ".sql": "sql",
    ".kt": "kotlin",
    ".vue": "vue",
    ".svelte": "svelte",
  };
  return MAPA[ext];
}

export function makeCodeFixer(): Fixer {
  return {
    can(finding: FixableFinding): FixEligibility {
      if (!finding.file?.trim()) {
        return { ok: false, reasonKey: "fix.cannot.noFile" };
      }
      // Sem trecho E sem linha não há como montar um prompt honesto: a IA
      // receberia "corrija este arquivo" e devolveria uma reescrita. Recusar é
      // mais útil que gerar uma correção que ninguém consegue revisar.
      if (!finding.codeSnippet?.trim() && !finding.line) {
        return { ok: false, reasonKey: "fix.cannot.noSnippet" };
      }
      return { ok: true };
    },

    async propose(finding, ctx: FixContext): Promise<FixProposal> {
      const input: FixInput = {
        vulnerabilityId: finding.id,
        file: finding.file,
        originalCode: finding.codeSnippet ?? "",
        description: finding.description,
        suggestion: finding.suggestion,
        language: languageOf(finding.file),
        line: finding.line,
        endLine: finding.endLine,
        cwe: finding.cwe,
        owasp: finding.owasp,
        ruleId: finding.ruleId,
        // Havendo código EM DISCO, `repoUrl` fica de fora — e isso é regra, não
        // otimização. Com ele preenchido, o engine de agente entra e clona o
        // repositório do GitHub: a correção sairia sobre o que está publicado,
        // não sobre o que a pessoa está editando no VS Code (que pode nem ter
        // sido enviado ainda). O `origin` do workspace local existe para abrir
        // Pull Request, não para reler o código de outro lugar.
        repoUrl: ctx.workspace?.kind === "local" ? undefined : ctx.repoUrl,
        token: ctx.token,
        // Workspace local: a correção lê o arquivo do disco em vez de buscá-lo
        // na API do GitHub. É o que faz o terminal e o VS Code corrigirem
        // código que ainda não foi enviado para lugar nenhum.
        workspaceRoot: ctx.workspace?.kind === "local" ? ctx.workspace.root : undefined,
        userInstructions: ctx.userInstructions,
        locale: ctx.locale,
        alsoFix: ctx.alsoFix?.map(toExtra),
        baseCode: ctx.baseCode,
      };

      const r = await generateFix(input);

      // O agente pode ter mexido em mais de um arquivo; a API mexe só em um.
      // `changes` unifica os dois casos para quem consome a proposta.
      const changes =
        r.changedFiles?.length
          ? r.changedFiles
          : [{ file: r.file, originalCode: r.originalCode, fixedCode: r.fixedCode }];

      return {
        findingId: finding.id,
        file: r.file,
        language: r.language,
        changes,
        explanation: r.explanation,
        engine: r.engine === "agent" ? "agent" : "api",
        noChange: !!r.noChange,
      };
    },

    async apply(proposal: FixProposal, ws: Workspace): Promise<void> {
      // Sequencial e não em paralelo: são poucos arquivos, e uma falha no meio
      // deixa um estado mais fácil de entender do que N gravações concorrentes.
      for (const c of proposal.changes) {
        if (c.fixedCode === c.originalCode) continue;
        await ws.writeFile(c.file, c.fixedCode);
      }
    },
  };
}
