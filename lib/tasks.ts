// ============================================================
// Lógica de cada fase (integração real). As rotas e o orquestrador (lib/jobs)
// chamam estas funções. NODE-ONLY.
// ============================================================
import "server-only";
import { ENGINES } from "@/lib/config";
import { DEFAULT_LOCALE, LOCALE_AI_NAME, type Locale } from "@/lib/i18n/config";
import { runAI, extractJSON, AIError } from "@/lib/ai";
import type {
  ThreatModel,
  SkillValidation,
  ScanResult,
  FixResult,
  Threat,
  Requirement,
  Vulnerability,
  DependencyVuln,
} from "@/types";

const THREAT_SYSTEM = `Você é um especialista em DevSecOps e modelagem de ameaças. Com base na descrição do sistema, identifique as principais ameaças e gere uma lista de requisitos técnicos de segurança. Considere: autenticação, autorização, criptografia, compliance (LGPD, ANS, PCI-DSS quando aplicável), ofuscação de dados sensíveis e boas práticas OWASP. Retorne JSON com os campos threats[] e requirements[].
Formato: {"summary":"...","threats":[{"id":"T-01","category":"...","title":"...","description":"...","severity":"critical|high|medium|low"}],"requirements":[{"id":"R-01","category":"...","text":"..."}]}`;

export async function generateThreatModel(
  systemDescription: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<ThreatModel> {
  const text = await runAI("plan", {
    system: `${THREAT_SYSTEM}

Escreva TODO o texto de saída em ${LOCALE_AI_NAME[locale]}.`,
    prompt: systemDescription.slice(0, 40000),
    // Alto o bastante para caber o "thinking" (que consome max_tokens nos
    // modelos novos) + o JSON completo, sem truncar.
    maxTokens: 8000,
  });
  const parsed = extractJSON<{
    summary?: string;
    threats?: Threat[];
    requirements?: Requirement[];
  }>(text);
  return {
    summary: parsed.summary,
    threats: parsed.threats || [],
    requirements: parsed.requirements || [],
  };
}

export async function validateSkills(
  skills: { name: string; content: string }[]
): Promise<SkillValidation[]> {
  if (!skills.length) return [];
  const { analyzeSkills } = await import("@/lib/skills");
  return analyzeSkills(skills);
}

// Sem repositório não há o que escanear: retorna um resultado vazio válido.
function emptyScan(): ScanResult {
  return {
    sast: { engine: ENGINES.sast, ran: false, vulnerabilities: [] },
    sca: { engine: ENGINES.sca, ran: false, dependencies: [] },
    review: {
      engine: "security-review",
      ran: false,
      findings: [],
      note: "Nenhum repositório informado.",
    },
  };
}

export async function runScan(
  repoUrl: string | undefined,
  token: string | undefined,
  ctx?: {
    systemDescription?: string;
    requirements?: Requirement[];
    locale?: Locale;
  }
): Promise<ScanResult> {
  if (!repoUrl) return emptyScan();

  const { cloneRepo, cleanup } = await import("@/lib/github");
  const { runSast } = await import("@/lib/sast");
  const { runSca } = await import("@/lib/sca");
  const { runAiReview } = await import("@/lib/review");
  const { ENGINES } = await import("@/lib/config");

  const { redactError } = await import("@/lib/redact");

  const { dir } = await cloneRepo(repoUrl, token);
  try {
    // Cada analisador é isolado: binário ausente em UM deles não pode derrubar
    // a fase inteira nem apagar os achados do outro. E `ran` passa a dizer a
    // verdade — antes era sempre true, mesmo com o engine desligado, o que
    // fazia a tela comemorar "nenhuma vulnerabilidade 🎉" sobre um repositório
    // que ninguém tinha analisado. Ver AUDITORIA.md#UX-15.
    const sastOff = ENGINES.sast === "none";
    const scaOff = ENGINES.sca === "none";

    const [sast, sca] = await Promise.all([
      sastOff
        ? Promise.resolve({
            engine: ENGINES.sast,
            ran: false,
            note: "SAST desligado por configuração (SAST_ENGINE=none).",
            vulnerabilities: [] as Vulnerability[],
          })
        : runSast(dir)
            .then((vulnerabilities) => ({
              engine: ENGINES.sast,
              ran: true,
              vulnerabilities,
            }))
            .catch((e) => ({
              engine: ENGINES.sast,
              ran: false,
              note: redactError(e).slice(0, 300),
              vulnerabilities: [] as Vulnerability[],
            })),
      scaOff
        ? Promise.resolve({
            engine: ENGINES.sca,
            ran: false,
            note: "SCA desligado por configuração (SCA_ENGINE=none).",
            dependencies: [] as DependencyVuln[],
          })
        : runSca(dir)
            .then((dependencies) => ({
              engine: ENGINES.sca,
              ran: true,
              dependencies,
            }))
            .catch((e) => ({
              engine: ENGINES.sca,
              ran: false,
              note: redactError(e).slice(0, 300),
              dependencies: [] as DependencyVuln[],
            })),
    ]);

    // Revisão por IA roda sobre o MESMO diretório clonado, depois do SAST/SCA
    // (precisa dos achados deles para deduplicar). Nunca lança.
    const review = await runAiReview(dir, {
      systemDescription: ctx?.systemDescription,
      requirements: ctx?.requirements || [],
      locale: ctx?.locale,
      sastFindings: sast.vulnerabilities,
      scaFindings: sca.dependencies,
    });

    // Descrições legíveis, no idioma do sistema. Catálogo local resolve a
    // maioria sem custo; a IA entra em lote só no que sobra. Nunca lança.
    // Ver AUDITORIA.md#FEAT-03.
    const { enrichFindings, enrichDependencies } = await import("@/lib/enrich");
    const [sastExplained, reviewExplained] = await Promise.all([
      enrichFindings(sast.vulnerabilities, ctx?.locale),
      enrichFindings(review.findings, ctx?.locale),
    ]);

    return {
      sast: { ...sast, vulnerabilities: sastExplained },
      // Dependências não passam por IA: o texto é montado por template.
      sca: {
        ...sca,
        dependencies: enrichDependencies(sca.dependencies, ctx?.locale),
      },
      review: { ...review, findings: reviewExplained },
    };
  } finally {
    await cleanup(dir);
  }
}

const FIX_SYSTEM = `Você é um engenheiro de segurança de software sênior fazendo uma correção cirúrgica. Você recebe o contexto exato de uma vulnerabilidade (arquivo, linha, regra, CWE, descrição) e o código — o ARQUIVO INTEIRO quando disponível, ou apenas o trecho.

Regras:
- Corrija SOMENTE o problema de segurança apontado. Não altere lógica de negócio, formatação de partes não relacionadas, nem outras vulnerabilidades — foque na que foi descrita.
- Quando receber o ARQUIVO INTEIRO, devolva o ARQUIVO INTEIRO já corrigido em "fixedCode" (nunca um fragmento), preservando tudo que não faz parte da correção. Os números de linha do prompt são só referência: NÃO os inclua na resposta.
- Quando receber apenas o TRECHO, devolva o TRECHO corrigido.
- Use a correção idiomática da linguagem, mantendo o estilo do arquivo. Adicione um comentário curto no ponto da correção explicando o porquê.
- Se houver "Instruções adicionais do revisor", siga-as — desde que não introduzam insegurança nem quebrem a lógica. Se conflitarem com a segurança, priorize a segurança e explique.

Responda em JSON válido, sem markdown: {"fixedCode":"<código corrigido>","explanation":"<o que mudou e por quê, em 1-3 frases>"}`;

const MAX_WHOLE_FILE = 100_000; // acima disso, cai para o modo trecho + splice

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
  repoUrl?: string; // para buscar o arquivo inteiro na hora
  token?: string;
  userInstructions?: string; // prompt personalizado por quem está na tela
  locale?: Locale; // idioma da explicação devolvida
  /**
   * Demais achados do MESMO arquivo. Corrigir todos numa passada só é o que
   * impede uma correção de sobrescrever a outra: cada uma era gerada a partir
   * do mesmo arquivo original e o PR só guardava a última.
   * Ver AUDITORIA.md#BUG-06.
   */
  alsoFix?: ExtraFinding[];
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

export async function generateFix(input: FixInput): Promise<FixResult> {
  // Engine de AGENTE (Claude Code): lê o repo e edita os arquivos. Se falhar
  // (SDK ausente, sem rede, timeout), cai para o disparo único na API abaixo.
  if (ENGINES.fix === "agent" && input.repoUrl) {
    try {
      const { agentFix } = await import("@/lib/agent-fix");
      return await agentFix(input);
    } catch (e) {
      console.error(
        "[fix] engine de agente falhou, usando a Claude API:",
        e instanceof Error ? e.message : e
      );
    }
  }

  // Engine de API: busca o arquivo inteiro (a árvore da Fase 3 já foi apagada).
  let wholeFile: string | null = null;
  if (input.repoUrl) {
    const { fetchFileContent } = await import("@/lib/github");
    wholeFile = await fetchFileContent(input.repoUrl, input.file, input.token);
  }
  const useWhole = !!wholeFile && wholeFile.length <= MAX_WHOLE_FILE;

  const text = await runAI("refactor", {
    system: `${FIX_SYSTEM}

Escreva a "explanation" em ${LOCALE_AI_NAME[input.locale || DEFAULT_LOCALE]}.`,
    prompt: buildFixPrompt(input, useWhole ? wholeFile : null),
    maxTokens: 16000,
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
