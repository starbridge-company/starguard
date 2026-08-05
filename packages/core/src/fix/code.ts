// ============================================================
// Correção de CÓDIGO — maquinário compartilhado pelos corretores.
//
// Quem chama isto não é o app: é o `Fixer` embutido em cada analisador. O
// analisador de código (`analyzers/sast.ts`) e o de regras de negócio
// (`analyzers/business.ts`) corrigem a mesma coisa — um arquivo-fonte — e por
// isso compartilham o motor daqui. O que muda entre eles é o CONTEXTO que
// entra no prompt, e isso cada um monta do seu jeito.
//
// A correção de DEPENDÊNCIA não passa por aqui: o alvo dela é determinístico
// (o Trivy já diz o pacote e a versão) e mora em `fix/deps.ts`.
//
// Dois engines, nesta ordem: o agente (Claude Agent SDK, lê o repositório e
// edita os arquivos) e, se ele falhar, o disparo único na API. NODE-ONLY.
// ============================================================
import { ENGINES, maxTokensForFix } from "../config";
import { DEFAULT_LOCALE, LOCALE_AI_NAME, type Locale } from "../i18n/config";
import { runAI, extractJSON, AIError } from "../ai";
import type { FixResult } from "../types";

const FIX_SYSTEM = `Você é um engenheiro de segurança de software sênior fazendo uma correção cirúrgica. Você recebe o contexto exato de uma vulnerabilidade (arquivo, linha, regra, CWE, descrição) e o código — o ARQUIVO INTEIRO quando disponível, ou apenas o trecho.

Regras:
- Corrija SOMENTE o problema de segurança apontado. Não altere lógica de negócio, formatação de partes não relacionadas, nem outras vulnerabilidades — foque na que foi descrita.
- Quando receber o ARQUIVO INTEIRO, devolva o ARQUIVO INTEIRO já corrigido em "fixedCode" (nunca um fragmento), preservando tudo que não faz parte da correção. Os números de linha do prompt são só referência: NÃO os inclua na resposta.
- Quando receber apenas o TRECHO, devolva o TRECHO corrigido.
- Use a correção idiomática da linguagem, mantendo o estilo do arquivo. Adicione um comentário curto no ponto da correção explicando o porquê.
- Se houver "Instruções adicionais do revisor", siga-as — desde que não introduzam insegurança nem quebrem a lógica. Se conflitarem com a segurança, priorize a segurança e explique.

Responda em JSON válido, sem markdown: {"fixedCode":"<código corrigido>","explanation":"<o que mudou e por quê, em 1-3 frases>"}`;

/**
 * Até que tamanho vale mandar o arquivo INTEIRO para a IA reescrever.
 *
 * O teto tem de sair do orçamento de SAÍDA, não de um número redondo: o modelo
 * precisa devolver o arquivo todo. Estava fixo em 100 000 caracteres enquanto
 * a saída cabia ~60 000 — ou seja, mandávamos arquivos que era impossível
 * receber de volta. O resultado era resposta truncada, retry com o dobro do
 * orçamento e, no fim, tempo esgotado: o caminho mais lento possível para
 * chegar a um erro.
 *
 * ~3 caracteres por token é conservador para código; o desconto de 15% deixa
 * espaço para o "thinking", que come o mesmo orçamento.
 */
function maxWholeFileChars(): number {
  return Math.floor(maxTokensForFix() * 3 * 0.85);
}

/** Achado adicional NO MESMO arquivo, corrigido na mesma passada. */
export interface ExtraFinding {
  vulnerabilityId: string;
  description: string;
  suggestion?: string;
  line?: number;
  endLine?: number;
  cwe?: string;
  owasp?: string;
  ruleId?: string;
}

export interface FixInput {
  vulnerabilityId: string;
  file: string;
  originalCode: string; // trecho vulnerável (fallback)
  description: string;
  suggestion?: string;
  language?: string;
  line?: number;
  endLine?: number;
  cwe?: string;
  owasp?: string;
  ruleId?: string;
  /**
   * De onde ler o arquivo inteiro quando ele não veio junto.
   *
   * `repoUrl` busca pela API do GitHub — é o caminho do painel web, que não
   * tem o repositório em disco na hora de corrigir (a árvore clonada durante o
   * scan já foi apagada). O terminal e a extensão do VS Code passam
   * `workspaceRoot`: o código está ali no disco, e ir buscá-lo na rede seria
   * lento, exigiria token e devolveria uma versão que não é a que a pessoa está
   * vendo no editor.
   */
  repoUrl?: string;
  token?: string;
  workspaceRoot?: string;
  userInstructions?: string; // prompt personalizado por quem está na tela
  locale?: Locale; // idioma da explicação devolvida
  /**
   * Demais achados do MESMO arquivo. Corrigir todos numa passada só é o que
   * impede uma correção de sobrescrever a outra: cada uma era gerada a partir
   * do mesmo arquivo original e o PR só guardava a última.
   * Ver AUDITORIA.md#BUG-06.
   */
  alsoFix?: ExtraFinding[];
  /**
   * Conteúdo de partida do arquivo, quando NÃO é o do repositório.
   *
   * Um arquivo com dezenas de achados não cabe num prompt só — nem em
   * qualidade, nem no limite de `alsoFix`. Ele é corrigido em fatias, e cada
   * fatia recebe aqui o resultado da anterior. Sem isto, a fatia 2 partiria do
   * arquivo original e apagaria o trabalho da fatia 1.
   */
  baseCode?: string;
}

/** Lista "1. problema (linha X) — regra/CWE" de todos os achados do arquivo. */
export function describeFindings(input: FixInput): string {
  const all = [
    {
      vulnerabilityId: input.vulnerabilityId,
      description: input.description,
      suggestion: input.suggestion,
      line: input.line,
      endLine: input.endLine,
      cwe: input.cwe,
      owasp: input.owasp,
      ruleId: input.ruleId,
    },
    ...(input.alsoFix || []),
  ];
  return all
    .map((f, i) => {
      const loc = f.line
        ? `linha ${f.line}${f.endLine && f.endLine !== f.line ? `–${f.endLine}` : ""}`
        : "linha não informada";
      const tags = [f.ruleId, f.cwe, f.owasp].filter(Boolean).join(" · ");
      return [
        `${i + 1}. [${loc}]${tags ? ` (${tags})` : ""}`,
        `   Problema: ${f.description}`,
        f.suggestion ? `   Sugestão do scanner: ${f.suggestion}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/** Numera as linhas do arquivo só para referência no prompt (não vai na resposta). */
function numberLines(src: string): string {
  return src
    .split("\n")
    .map((l, i) => `${i + 1}| ${l}`)
    .join("\n");
}

/** Substitui as linhas [start, end] (1-based) por `replacement`, reconstruindo o arquivo. */
function spliceLines(
  whole: string,
  start: number,
  end: number,
  replacement: string
): string | null {
  const lines = whole.split(/\r?\n/);
  if (!Number.isFinite(start) || start < 1 || start > lines.length) return null;
  const s = start - 1;
  const e = Math.min(Math.max(end, start), lines.length);
  const repl = replacement.replace(/\r?\n$/, "").split(/\r?\n/);
  return [...lines.slice(0, s), ...repl, ...lines.slice(e)].join("\n");
}

function buildFixPrompt(input: FixInput, wholeFile: string | null): string {
  const total = 1 + (input.alsoFix?.length || 0);
  const parts = [
    `Arquivo: ${input.file}`,
    `Linguagem: ${input.language || "desconhecida"}`,
    total > 1
      ? `\n${total} vulnerabilidades a corrigir NESTE MESMO arquivo — corrija TODAS na mesma resposta:`
      : `\nVulnerabilidade a corrigir:`,
    describeFindings(input),
  ].filter(Boolean);

  const instr = input.userInstructions?.trim();
  if (instr) {
    parts.push(
      `\nInstruções adicionais do revisor (priorize, sem quebrar a lógica de negócio):\n${instr.slice(0, 2000)}`
    );
  }

  if (wholeFile) {
    parts.push(
      `\nArquivo COMPLETO (números de linha só para referência — NÃO os inclua na resposta):\n\`\`\`\n${numberLines(wholeFile)}\n\`\`\`\n\nDevolva o ARQUIVO INTEIRO corrigido em "fixedCode".`
    );
  } else {
    parts.push(
      `\nTrecho vulnerável:\n\`\`\`\n${input.originalCode}\n\`\`\`\n\nDevolva apenas o trecho corrigido em "fixedCode".`
    );
  }
  return parts.join("\n");
}

/**
 * Lê o arquivo inteiro da origem disponível.
 *
 * Ordem de preferência: o que já veio pronto (`baseCode`, continuação de uma
 * correção em fatias) → o disco (`workspaceRoot`, terminal e VS Code) → a API
 * do GitHub (`repoUrl`, painel web). A leitura em disco é confinada à raiz do
 * workspace: `file` vem de um relatório de scanner, e um `../../etc/passwd`
 * ali dentro não pode virar leitura fora do projeto.
 */
async function loadWholeFile(input: FixInput): Promise<string | null> {
  if (input.baseCode) return input.baseCode;

  if (input.workspaceRoot) {
    const { readFile } = await import("node:fs/promises");
    const { resolve, sep } = await import("node:path");
    const root = resolve(input.workspaceRoot);
    const alvo = resolve(root, input.file);
    if (alvo !== root && !alvo.startsWith(root + sep)) return null;
    return readFile(alvo, "utf8").catch(() => null);
  }

  if (input.repoUrl) {
    const { fetchFileContent } = await import("../git");
    return fetchFileContent(input.repoUrl, input.file, input.token);
  }
  return null;
}

export async function generateFix(input: FixInput): Promise<FixResult> {
  // Engine de AGENTE (Claude Code): lê o repo e edita os arquivos. Se falhar
  // (SDK ausente, sem rede, timeout), cai para o disparo único na API abaixo.
  //
  // Exige `repoUrl` — e isso não é limitação, é desenho. O agente EDITA os
  // arquivos onde está trabalhando; com `repoUrl` ele trabalha num clone
  // descartável e o diff sai por `git diff`. Apontá-lo para um `workspaceRoot`
  // faria com que ele reescrevesse a árvore de trabalho de quem só pediu para
  // VER a correção — e `propose()` não pode escrever nada. No terminal e no
  // VS Code a correção sai pela API, que lê o arquivo do disco e devolve o
  // conteúdo corrigido sem tocar em nada; quem grava é `apply()`.
  //
  // `baseCode` também o desqualifica: o agente sempre parte do repositório
  // clonado, e numa correção em fatias isso faria a fatia 2 desfazer a fatia 1.
  // Quando há continuação, a API é o caminho — é ela que aceita um ponto de
  // partida.
  if (ENGINES.fix === "agent" && input.repoUrl && !input.baseCode) {
    try {
      const { agentFix } = await import("./agent");
      return await agentFix(input);
    } catch (e) {
      console.error(
        "[fix] engine de agente falhou, usando a Claude API:",
        e instanceof Error ? e.message : e
      );
    }
  }

  const wholeFile = await loadWholeFile(input);
  const useWhole = !!wholeFile && wholeFile.length <= maxWholeFileChars();

  const text = await runAI("refactor", {
    system: `${FIX_SYSTEM}

Escreva a "explanation" em ${LOCALE_AI_NAME[input.locale || DEFAULT_LOCALE]}.`,
    prompt: buildFixPrompt(input, useWhole ? wholeFile : null),
    maxTokens: maxTokensForFix(),
  });
  const parsed = extractJSON<{ fixedCode?: string; explanation?: string }>(text);

  // Sem `fixedCode` a versão anterior devolvia o PRÓPRIO original rotulado como
  // "Correção gerada pela IA" — o usuário via uma correção que não corrigia
  // nada e podia abrir um PR vazio. Falhar aqui é honesto e acionável.
  // Ver AUDITORIA.md#BUG-10.
  if (!parsed.fixedCode || !parsed.fixedCode.trim()) {
    throw new AIError(
      "A IA não devolveu código corrigido. Tente de novo, ou ajuste as instruções para ser mais específico sobre a correção esperada.",
      "bad_output"
    );
  }
  const aiCode = parsed.fixedCode;

  let originalCode = useWhole ? wholeFile! : input.originalCode;
  let fixedCode = aiCode;

  // Arquivo grande demais para enviar inteiro: a IA corrigiu só o trecho, mas
  // ainda queremos gravar o arquivo inteiro no PR — recompomos via splice.
  if (!useWhole && wholeFile && input.line) {
    const spliced = spliceLines(
      wholeFile,
      input.line,
      input.endLine || input.line,
      aiCode
    );
    if (spliced) {
      originalCode = wholeFile;
      fixedCode = spliced;
    }
  }

  return {
    vulnerabilityId: input.vulnerabilityId,
    file: input.file,
    language: input.language,
    engine: "api",
    usedWholeFile: useWhole || (!!wholeFile && !!input.line),
    originalCode,
    fixedCode,
    explanation: parsed.explanation || "Correção gerada pela IA.",
    noChange: fixedCode.trim() === originalCode.trim(),
  };
}
