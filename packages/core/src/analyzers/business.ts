// ============================================================
// Revisão de segurança por IA (Fase 3) — porta a skill `security-review`
// do time como system prompt e roda DEPOIS do SAST/SCA. NODE-ONLY.
//
// Objetivo: encontrar o que scanners de padrão NÃO pegam — violação de regra
// de negócio (com base no contexto do sistema), IDOR/autorização e lógica
// multi-arquivo. Os achados são deduplicados contra o SAST/SCA para não
// repetir o que o Opengrep/Trivy já reportaram.
// ============================================================
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { runAI, extractJSON } from "../ai";
import { AI_BY_PHASE, phaseMaxTokens } from "../config";
// Regra única de deduplicação, compartilhada com a tela (AUDITORIA.md#ARQ-10).
import { collidesWithSast, collidesWithSca, normPath } from "../dedup";
import { DEFAULT_LOCALE, LOCALE_AI_NAME, type Locale } from "../i18n/config";
import { enrichFindings } from "../enrich";
import { makeCodeFixer } from "../fix/code-fixer";
import { hasAnyAiKey } from "../ai";
import type { Analyzer } from "../contracts";
import type {
  Vulnerability,
  DependencyVuln,
  Requirement,
  Severity,
  ScanResult,
} from "../types";

type ReviewSection = NonNullable<ScanResult["review"]>;

export interface ReviewContext {
  locale?: Locale;
  systemDescription?: string;
  requirements: Requirement[];
  sastFindings: Vulnerability[];
  scaFindings: DependencyVuln[];
}

// ------------------------------------------------------------
// System prompt = catálogo da skill security-review (Parte A + B),
// calibração de severidade e filtro de FP — com o FORMATO trocado para JSON
// (a skill entrega tabela; o app precisa de achados estruturados) e a
// deduplicação + foco em regra de negócio reforçados.
// ------------------------------------------------------------
const reviewSystem = (locale: Locale) => `Você é um revisor de segurança de aplicações (AppSec) sênior. Scanners automáticos (SAST/SCA) JÁ rodaram sobre este código — seu valor está em achar o que ferramentas de PADRÃO não pegam. Escreva TODO o texto de saída em ${LOCALE_AI_NAME[locale]}.

METODOLOGIA (skill security-review)
- Calibre a severidade ao domínio (impacto × exploitabilidade × dados sensíveis/compliance) antes de classificar.
- Só reporte com >80% de confiança de exploitabilidade real e caminho de ataque concreto. Na dúvida, NÃO reporte.
- Nada de vulnerabilidade teórica: se não há um PoC/caminho de ataque claro, não reporte.

DEDUPLICAÇÃO (OBRIGATÓRIO)
- Tudo em JÁ_ENCONTRADOS_PELO_SCANNER já foi reportado pelo SAST/SCA. NÃO repita esses achados nem variações no mesmo arquivo/linha ou com o mesmo CWE. Se o que você viu é só uma variação do que o scanner pegou, ignore.
- DEPENDÊNCIAS vulneráveis (pacote com CVE, biblioteca desatualizada em package.json/lockfile) são responsabilidade do SCA (Trivy) e já estão em JÁ_ENCONTRADOS. NÃO reporte pacote/versão vulnerável nem CVE de dependência — foque no CÓDIGO e na regra de negócio.

FOCO — priorize o que o scanner NÃO enxerga
1. VIOLAÇÃO DE REGRA DE NEGÓCIO. Leia CONTEXTO_DO_SISTEMA e REQUISITOS e extraia APENAS as regras EXPLICITAMENTE declaradas ali. Para cada regra declarada, verifique no código:
   - violada → finding com "kind":"business-rule", referenciando o id do requisito em "requirementRefs".
   - cumprida → não reporte.
   - não verificável no código fornecido → NÃO invente; coloque em "unverifiedRules" com o motivo.
   NUNCA sinalize a AUSÊNCIA de uma regra que não foi declarada. O contexto costuma ser incompleto — valide só as regras que ESTÃO lá, sem supor as que faltam.
2. Controle de acesso quebrado / IDOR: leitura/escrita de recurso sem checar posse (escopo por usuário/empresa/tenant), não só autenticação.
3. Autorização entre papéis, falhas de sessão, e fluxo lógico que atravessa funções/arquivos (taint multi-arquivo).
4. Se o projeto usa LLM (anthropic/openai/claude/gpt/gemini/langchain/embeddings/system prompt): OWASP Top 10 for LLM — prompt injection, system prompt leakage, output handling inseguro, excessive agency, vazamento de dados sensíveis.

CATÁLOGO DE REFERÊNCIA (lente; lembre que o mecânico já foi pego pelo SAST)
[Crítico] SQLi, Command Injection, XSS, XXE, Path Traversal, Insecure Deserialization, Code Injection, Hardcoded Secrets.
[Alto] Insecure Crypto, Insecure Transport, SSRF (só se o atacante controla host/protocolo), JWT (assinatura/algoritmo), CSRF, Prototype Pollution, IDOR/Broken Access Control, Auth/Sessão, Uploads, Webhooks sem verificação de assinatura.

NÃO REPORTE (filtro de falso positivo): DoS/rate-limit/exaustão de recursos; achados teóricos sem caminho de ataque; segredos já protegidos por outro processo.

SAÍDA — responda APENAS com JSON válido (sem markdown, sem comentários):
{"findings":[{"kind":"business-rule|code","title":"...","severity":"critical|high|medium|low","file":"caminho/relativo","line":123,"endLine":125,"description":"o problema e o caminho de ataque concreto","codeSnippet":"trecho relevante do código","suggestion":"como corrigir","cwe":"CWE-XX (se aplicável)","owasp":"(se aplicável)","requirementRefs":["R-02"],"confidence":"high|medium"}],"unverifiedRules":[{"requirementRef":"R-07","rule":"regra declarada no contexto","reason":"por que não deu para verificar no código fornecido"}]}
Se não houver achados de alta confiança, retorne {"findings":[],"unverifiedRules":[...]}.`;

// ------------------------------------------------------------
// Coleta de código-fonte (com orçamento) — não dá para mandar um repo grande
// inteiro num único prompt. Prioriza arquivos sensíveis por caminho e os que
// o SAST já apontou, cabe dentro de um orçamento de bytes e trunca o excesso.
// ------------------------------------------------------------
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".turbo", ".cache", "dist", "build", "out",
  "coverage", "vendor", "__pycache__", ".venv", "venv", "target", "bin", "obj",
]);

const SOURCE_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rb",
  ".php", ".cs", ".rs", ".sql", ".sol", ".kt", ".scala", ".vue", ".svelte",
]);

// Caminhos que concentram risco de autorização / regra de negócio.
const PRIORITY_RE =
  /(auth|login|logout|session|sess[aã]o|token|jwt|password|senha|route|rota|api|controller|handler|endpoint|middleware|service|servi[çc]o|db|database|sql|query|repository|model|payment|pagamento|billing|checkout|order|pedido|refund|reembolso|admin|user|usuario|account|conta|permission|permiss|access|acesso|acl|role|papel|tenant|empresa|company|upload|webhook|crypto|cripto|secret|segredo)/i;

interface Candidate {
  path: string;
  abs: string;
  size: number;
  priority: boolean;
}

async function collectSourceFiles(
  dir: string,
  priorityPaths: string[],
  opts: { maxFiles?: number; perFileBytes?: number; totalBudget?: number } = {}
): Promise<{
  files: { path: string; content: string }[];
  discovered: number;
  truncated: number;
}> {
  const maxFiles = opts.maxFiles ?? 40;
  const perFileBytes = opts.perFileBytes ?? 24 * 1024;
  const totalBudget = opts.totalBudget ?? 180 * 1024;
  const wanted = new Set(priorityPaths.map(normPath));

  const all: Candidate[] = [];
  async function walk(cur: string, rel: string): Promise<void> {
    if (all.length > 5000) return; // trava de descoberta em repos gigantes
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(cur, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        await walk(abs, relPath);
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase();
        if (!SOURCE_EXT.has(ext)) continue;
        if (/\.min\.(js|css)$/i.test(e.name) || /\.d\.ts$/i.test(e.name)) continue;
        let size = 0;
        try {
          size = (await stat(abs)).size;
        } catch {
          continue;
        }
        if (size === 0 || size > 400 * 1024) continue; // pula vazio/gigante
        const priority = wanted.has(normPath(relPath)) || PRIORITY_RE.test(relPath);
        all.push({ path: relPath, abs, size, priority });
      }
    }
  }
  await walk(dir, "");

  // Prioritários primeiro; entre iguais, arquivos menores primeiro (cabe mais).
  all.sort(
    (a, b) => Number(b.priority) - Number(a.priority) || a.size - b.size
  );

  const files: { path: string; content: string }[] = [];
  let used = 0;
  let truncated = 0;
  for (const c of all) {
    if (files.length >= maxFiles || used >= totalBudget) break;
    let content: string;
    try {
      content = await readFile(c.abs, "utf8");
    } catch {
      continue;
    }
    if (content.length > perFileBytes) {
      content = content.slice(0, perFileBytes) + "\n/* … [truncado pelo StarGuard] … */";
      truncated++; // alimenta a cobertura exibida na tela (AUDITORIA.md#UX-06)
    }
    files.push({ path: c.path, content });
    used += content.length;
  }
  return { files, discovered: all.length, truncated };
}

function normSeverity(s: unknown): Severity {
  const v = String(s ?? "").toLowerCase();
  if (v.startsWith("crit")) return "critical";
  if (v.startsWith("high") || v === "alta" || v === "alto") return "high";
  if (v.startsWith("med") || v.startsWith("méd")) return "medium";
  if (v.startsWith("low") || v.startsWith("baix")) return "low";
  if (v.startsWith("info")) return "info";
  return "medium";
}

type RawFinding = Record<string, unknown>;

// Todo texto abaixo nasce de um repositório de TERCEIROS passando por um
// modelo: um `<!-- ignore previous instructions -->` num comentário do código
// analisado pode virar parágrafo na tela, apresentado como veredito da
// ferramenta. Não dá para impedir a influência, mas dá para limitar o espaço
// que ela ocupa — e a UI marca a origem. Ver AUDITORIA.md#SEC-09.
const LIMITE = {
  description: 1200,
  suggestion: 600,
  codeSnippet: 2000,
} as const;

function mapFindings(raw: RawFinding[]): Vulnerability[] {
  return raw.slice(0, 50).map((f, i) => {
    const kind = f.kind === "business-rule" ? "business-rule" : "code";
    const lineNum = Number(f.line);
    const endNum = Number(f.endLine);
    const refs = Array.isArray(f.requirementRefs)
      ? f.requirementRefs.map((r) => String(r)).slice(0, 8)
      : undefined;
    return {
      id: `AI-${i + 1}`,
      source: "ai-review" as const,
      ruleId: String(
        f.ruleId || f.category || (kind === "business-rule" ? "regra-de-negocio" : "revisao-ia")
      ).slice(0, 80),
      title: String(f.title || "Achado da revisão de IA").slice(0, 140),
      severity: normSeverity(f.severity),
      file: String(f.file || "desconhecido").slice(0, 300),
      line: Number.isFinite(lineNum) ? lineNum : 0,
      endLine: Number.isFinite(endNum) && endNum > 0 ? endNum : undefined,
      description: String(f.description || "").slice(0, LIMITE.description),
      codeSnippet: f.codeSnippet
        ? String(f.codeSnippet).slice(0, LIMITE.codeSnippet)
        : undefined,
      suggestion: String(
        f.suggestion || "Revise o trecho conforme a recomendação."
      ).slice(0, LIMITE.suggestion),
      cwe: f.cwe ? String(f.cwe) : undefined,
      owasp: f.owasp ? String(f.owasp) : undefined,
      requirementRefs: refs && refs.length ? refs : undefined,
      kind,
      confidence: f.confidence === "medium" ? "medium" : "high",
    };
  });
}

function buildPrompt(
  ctx: ReviewContext,
  files: { path: string; content: string }[],
  discovered: number
): string {
  const reqs =
    ctx.requirements.map((r) => `${r.id} [${r.category}] ${r.text}`).join("\n") ||
    "(nenhum requisito da Fase 1 informado)";
  const sastList =
    ctx.sastFindings
      .map((f) => `- ${f.file}:${f.line} ${f.cwe || ""} ${f.title}`.trim())
      .join("\n") || "(nenhum)";
  const scaList =
    ctx.scaFindings
      .map((d) => `- ${d.package}@${d.installedVersion} ${d.cve} ${d.title}`)
      .join("\n") || "(nenhum)";
  const code = files
    .map((f) => `\n===== ${f.path} =====\n${f.content}`)
    .join("\n");

  return `## CONTEXTO_DO_SISTEMA
${ctx.systemDescription?.slice(0, 8000) || "(não informado)"}

## REQUISITOS (Fase 1 — use os ids em requirementRefs)
${reqs}

## JÁ_ENCONTRADOS_PELO_SCANNER (NÃO re-reporte estes nem variações próximas)
### SAST
${sastList}
### SCA
${scaList}

## CÓDIGO (${files.length} de ${discovered} arquivos elegíveis; alguns podem estar truncados)
${code}`;
}

interface ReviewBudget {
  maxFiles?: number;
  perFileBytes?: number;
  totalBudget?: number;
}

const STRICT_SUFFIX =
  "\n\nIMPORTANTE: responda EXCLUSIVAMENTE com o objeto JSON pedido, começando por { e terminando por }. Sem raciocínio no texto final, sem markdown, sem nada fora do JSON.";

type ParsedReview = { findings?: RawFinding[]; unverifiedRules?: unknown[] };

/** Quanto do repositório a revisão realmente leu (AUDITORIA.md#UX-06). */
type Coverage = NonNullable<ReviewSection["coverage"]>;

/** Uma tentativa de revisão com um orçamento de código específico. */
async function reviewAttempt(
  dir: string,
  ctx: ReviewContext,
  budget: ReviewBudget,
  strict: boolean,
  locale: Locale
): Promise<
  | { empty: true }
  | { empty: false; parsed: ParsedReview; coverage: Coverage }
> {
  const { files, discovered, truncated } = await collectSourceFiles(
    dir,
    ctx.sastFindings.map((f) => f.file),
    budget
  );
  if (!files.length) return { empty: true };

  const text = await runAI("software", {
    system: strict
      ? reviewSystem(locale) + STRICT_SUFFIX
      : reviewSystem(locale),
    // Teto alto: nos modelos com extended thinking o raciocínio consome
    // max_tokens; sem folga, o bloco de texto (o JSON) volta vazio/truncado.
    maxTokens: phaseMaxTokens(3),
    prompt: buildPrompt(ctx, files, discovered),
  });

  return {
    empty: false,
    parsed: extractJSON<ParsedReview>(text),
    coverage: {
      filesReviewed: files.length,
      filesEligible: discovered,
      truncatedFiles: truncated,
    },
  };
}

/**
 * Roda a revisão por IA sobre o diretório clonado. Nunca lança: qualquer falha
 * (sem API key, timeout, JSON inválido) vira uma seção com ran=false + nota,
 * para não derrubar o scan de SAST/SCA que já rodou. Faz 1 retry com escopo
 * reduzido quando a 1ª resposta vem vazia/sem JSON (thinking comeu o orçamento).
 */
export async function runAiReview(
  dir: string,
  ctx: ReviewContext
): Promise<ReviewSection> {
  const engine = "security-review (IA)";
  const model = AI_BY_PHASE.software.model;
  const noKeyNote =
    "Revisão por IA não executada: sem API key configurada. SAST/SCA rodaram normalmente.";

  let parsed: ParsedReview;
  let coverage: Coverage | undefined;
  try {
    const locale = ctx.locale || DEFAULT_LOCALE;
    const first = await reviewAttempt(dir, ctx, {}, false, locale);
    if (first.empty) {
      return {
        engine,
        ran: false,
        model,
        findings: [],
        note: "Nenhum arquivo de código elegível para revisão por IA.",
      };
    }
    parsed = first.parsed;
    coverage = first.coverage;
  } catch (e1) {
    if ((e1 as { code?: string }).code === "no_key") {
      return { engine, ran: false, model, findings: [], note: noKeyNote };
    }
    // 2ª tentativa: menos código + instrução estrita, para caber output + JSON.
    try {
      const retry = await reviewAttempt(
        dir,
        ctx,
        { maxFiles: 15, perFileBytes: 14 * 1024, totalBudget: 60 * 1024 },
        true,
        ctx.locale || DEFAULT_LOCALE
      );
      if (retry.empty) throw e1;
      parsed = retry.parsed;
      coverage = retry.coverage;
    } catch (e2) {
      const err = e2 as { code?: string; message?: string };
      const note =
        err.code === "no_key"
          ? noKeyNote
          : `Revisão por IA indisponível: ${(err.message || "erro desconhecido").slice(0, 160)}`;
      return { engine, ran: false, model, findings: [], note };
    }
  }

  const mapped = mapFindings(parsed.findings || []);
  const findings = mapped.filter(
    (f) =>
      !collidesWithSast(f, ctx.sastFindings) &&
      !collidesWithSca(f, ctx.scaFindings)
  );
  const dropped = mapped.length - findings.length;

  const unverifiedRules = (parsed.unverifiedRules || [])
    .slice(0, 20)
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        requirementRef: o.requirementRef ? String(o.requirementRef) : undefined,
        rule: String(o.rule || ""),
        reason: String(o.reason || ""),
      };
    })
    .filter((r) => r.rule);

  return {
    engine,
    ran: true,
    model,
    findings,
    coverage,
    unverifiedRules: unverifiedRules.length ? unverifiedRules : undefined,
    note:
      dropped > 0
        ? `${dropped} achado(s) descartado(s) por sobreposição com SAST/SCA.`
        : undefined,
  };
}

// ------------------------------------------------------------
// O analisador
// ------------------------------------------------------------

/**
 * Regras de negócio como analisador independente.
 *
 * `uses` declara SAST, SCA e modelagem — mas como enriquecimento, não como
 * pré-requisito. Com eles no plano, os achados saem deduplicados contra o que
 * o scanner já reportou e os requisitos declarados são conferidos um a um. Sem
 * eles, roda igual: revisa o código pelo que consegue ler e o orquestrador
 * registra a degradação, que a tela e o terminal repetem em voz alta.
 *
 * É este `uses` opcional que faz `--only business` ser um comando legítimo.
 * Fosse pré-requisito, pedir regras de negócio arrastaria o Trivy junto — e o
 * pipeline linear estaria de volta com outro nome.
 */
export const businessAnalyzer: Analyzer<ReviewSection> = {
  id: "business",
  needs: { workspace: true, ai: true },
  uses: ["threat", "sast", "sca"],

  async probe({ hasWorkspace }) {
    if (!hasWorkspace) return { ok: false, reason: "no_workspace" };
    if (!hasAnyAiKey()) return { ok: false, reason: "no_ai_key" };
    return { ok: true, detail: AI_BY_PHASE.software.model };
  },

  async run(ctx) {
    ctx.report?.(AI_BY_PHASE.software.model);
    const review = await runAiReview(ctx.workspace!.root, {
      locale: ctx.locale,
      systemDescription: ctx.systemDescription,
      requirements: ctx.upstream.requirements ?? [],
      sastFindings: ctx.upstream.sastFindings ?? [],
      scaFindings: ctx.upstream.scaFindings ?? [],
    });
    // Descrições legíveis no idioma do sistema, igual ao SAST. Nunca lança.
    const findings = await enrichFindings(review.findings, ctx.locale);
    return { ...review, findings };
  },

  // Corrige código, como o SAST — o que muda é a origem do achado, não o alvo.
  fix: makeCodeFixer(),
};
