// ============================================================
// StarGuard — tipos de domínio compartilhados (frontend + API)
// ============================================================

export type Severity = "critical" | "high" | "medium" | "low" | "info";

/**
 * `skipped` = a etapa não foi escolhida para esta execução, ou não tinha como
 * rodar (sem repositório, binário ausente, sem chave de IA).
 *
 * Precisou existir quando o fluxo deixou de ser linear: antes, as quatro fases
 * sempre rodavam, e o que não rodou só podia ser `pending` (ainda vai) ou
 * `error` (deu errado). "Não pedi isto" não é nenhum dos dois, e apresentá-lo
 * como qualquer um deles seria mentir na tela — no `pending`, uma análise
 * terminada pareceria travada; no `error`, uma escolha deliberada pareceria
 * falha. É a mesma exigência do UX-15: nunca confundir "não encontrou" com
 * "não procurou".
 */
export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export type PhaseKey = "plan" | "skills" | "software" | "refactor";

/**
 * Os analisadores independentes. Cada um roda sozinho, tem o seu próprio
 * diagnóstico de disponibilidade e traz o seu corretor embutido.
 *
 * Não é o mesmo eixo que `PhaseKey`: aquele descreve as quatro fases do fluxo
 * antigo (e continua sendo o formato gravado no banco, para não migrar dado
 * histórico). `software` sozinha embrulhava três analisadores diferentes —
 * `sast`, `sca` e `business` —, e é exatamente essa amarração que impedia
 * pedir "só o Trivy". Ver `analyzerToPhase` em `compat.ts`.
 */
export const ANALYZER_IDS = [
  "threat",
  "sast",
  "sca",
  "business",
  "skills",
] as const;

export type AnalyzerId = (typeof ANALYZER_IDS)[number];

export function isAnalyzerId(v: unknown): v is AnalyzerId {
  return typeof v === "string" && (ANALYZER_IDS as readonly string[]).includes(v);
}

export type AIProvider = "anthropic" | "openai" | "google";

export interface StepAIConfig {
  provider: AIProvider;
  model: string;
}

// ---- Fase 1 — Threat Modeling ----
export interface Threat {
  id: string;
  category: string; // ex.: "Autenticação", "Injeção", "LGPD"
  title: string;
  description: string;
  severity: Severity;
}

export interface Requirement {
  id: string;
  category: string;
  text: string;
}

export interface ThreatModel {
  threats: Threat[];
  requirements: Requirement[];
  summary?: string;
}

// ---- Fase 2 — Validação de Skills ----
export type SkillVerdict = "approved" | "rejected" | "review";

export interface SkillFinding {
  id: string;
  type:
    | "prompt-injection"
    | "data-exfiltration"
    | "backdoor"
    | "policy-bypass"
    | "missing-content"
    | "suspicious-pattern";
  severity: Severity;
  title: string;
  description: string;
  snippet?: string;
  line?: number;
  recommendation: string;
  /**
   * Chaves de tradução do achado HEURÍSTICO (determinístico, texto nosso).
   * O `title`/`recommendation` em texto continuam preenchidos: análises
   * gravadas antes desta mudança não têm chave, e a tela cai neles.
   * Achado vindo da IA já nasce no idioma do usuário e não tem chave.
   * Ver AUDITORIA.md#FEAT-04.
   */
  titleKey?: string;
  recommendationKey?: string;
}

export interface SkillValidation {
  skillName: string;
  verdict: SkillVerdict;
  findings: SkillFinding[];
  /** `labelKey` é a fonte; `label` fica para as análises antigas. */
  checkedItems: { label: string; labelKey?: string; ok: boolean }[];
}

/**
 * Explicação legível de um achado. O texto cru do scanner é seco, técnico e em
 * inglês ("An action sourced from a third-party repository…") — quem lê precisa
 * saber o que é, por que importa e como corrigir. Ver AUDITORIA.md#FEAT-03.
 */
export interface FindingExplain {
  /**
   * Título curto no idioma do sistema. O título original vem do scanner em
   * inglês e é a primeira coisa que se lê no card — traduzi-lo é metade do
   * valor do enriquecimento.
   */
  title?: string;
  /** O que é o problema, em uma frase. */
  whatItIs: string;
  /** Por que é perigoso NESTE contexto. */
  whyItMatters: string;
  /** Caminho de ataque concreto (quando aplicável). */
  attackScenario?: string;
  /** Como corrigir, de forma acionável. */
  howToFix: string;
  /**
   * De onde veio o texto: catálogo local (instantâneo, sem custo), IA, ou
   * nenhum dos dois — caso em que a UI precisa deixar claro que o texto é o
   * original da ferramenta, em inglês.
   */
  source: "catalog" | "ai" | "scanner";
}

// ---- Fase 3 — Scan (SAST + SCA + revisão por IA) ----
export interface Vulnerability {
  id: string;
  source: "sast" | "ai-review";
  ruleId: string;
  title: string;
  severity: Severity;
  file: string;
  line: number;
  endLine?: number;
  description: string;
  codeSnippet?: string;
  suggestion: string;
  cwe?: string;
  owasp?: string;
  requirementRefs?: string[]; // ids de requisitos da Fase 1
  falsePositive?: boolean;
  // Campos preenchidos apenas quando source === "ai-review" (lib/review.ts):
  kind?: "code" | "business-rule"; // regra de negócio vs. falha de código que o SAST não pegou
  confidence?: "high" | "medium"; // calibração da skill (só reporta com >80% de confiança)
  /** Descrição enriquecida no idioma do sistema (lib/enrich.ts). */
  explain?: FindingExplain;
}

/**
 * O que o fluxo de correção precisa saber sobre um achado.
 *
 * Existe para o modal de correção servir tanto a uma vulnerabilidade de código
 * quanto a uma dependência vulnerável — que não é `Vulnerability` (não tem
 * arquivo nem linha próprios) mas tem correção igualmente. `Vulnerability`
 * satisfaz esta forma naturalmente; a dependência é adaptada em
 * `lib/deps-fix.ts`.
 */
export interface FixTarget {
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  file: string;
  line: number;
  endLine?: number;
  description: string;
  suggestion?: string;
  codeSnippet?: string;
  cwe?: string;
  owasp?: string;
  explain?: FindingExplain;
}

// Regra de negócio declarada no contexto que a IA NÃO conseguiu confirmar nem
// refutar no código analisado — reportada como ressalva, nunca como vulnerabilidade.
export interface UnverifiedRule {
  requirementRef?: string;
  rule: string;
  reason: string;
}

export interface DependencyVuln {
  id: string;
  source: "sca";
  package: string;
  installedVersion: string;
  fixedVersion?: string;
  severity: Severity;
  cve: string;
  title: string;
  description: string;
  /** Arquivo que o scanner leu (normalmente o lockfile). */
  lockfile?: string;
  /** Manifesto que se edita à mão — é nele que a correção mexe. */
  manifest?: string;
  /** "npm", "pip", "gomod"… define como regerar o lock. */
  ecosystem?: string;
  /** Descrição enriquecida no idioma do sistema (lib/enrich.ts). */
  explain?: FindingExplain;
}

export interface ScanResult {
  sast: {
    engine: string;
    // `ran` significa "o analisador REALMENTE executou". Engine desligado ou
    // binário ausente => false + `note` explicando. A UI depende disso para
    // não confundir "nada encontrado" com "nada foi procurado".
    ran: boolean;
    note?: string;
    vulnerabilities: Vulnerability[];
  };
  sca: {
    engine: string;
    ran: boolean;
    note?: string;
    dependencies: DependencyVuln[];
  };
  // Revisão por IA (skill security-review): complementa os scanners com o que
  // eles não pegam — regra de negócio, IDOR/autorização, lógica multi-arquivo.
  // Deduplicada contra os achados de SAST/SCA. Opcional: pode não ter rodado.
  review?: {
    engine: string;
    ran: boolean;
    model?: string;
    findings: Vulnerability[]; // sempre source === "ai-review"
    unverifiedRules?: UnverifiedRule[];
    note?: string; // motivo de não ter rodado, ou resumo do dedupe
    // Quanto do repositório a revisão realmente leu. Sem isto, a tela
    // apresentava o resultado como se fosse a análise do projeto inteiro
    // quando na prática foram ~40 arquivos. Ver AUDITORIA.md#UX-06.
    coverage?: {
      filesReviewed: number;
      filesEligible: number;
      truncatedFiles: number;
    };
  };
}

// ---- Fase 4 — Fix ----
export interface FixResult {
  vulnerabilityId: string;
  originalCode: string; // arquivo inteiro (ou o trecho, no fallback)
  fixedCode: string; // arquivo inteiro corrigido (o PR grava isto)
  explanation: string;
  file: string;
  language?: string;
  usedWholeFile?: boolean; // true = IA recebeu o arquivo completo; false = só o trecho
  engine?: "api" | "agent"; // como a correção foi gerada
  // true = a IA/agente não propôs alteração alguma (código de saída idêntico
  // ao de entrada). A UI precisa avisar e NÃO oferecer PR — senão o usuário
  // abre um pull request vazio achando que corrigiu.
  noChange?: boolean;
  // Preenchido pelo engine de agente (Claude Code): todos os arquivos que ele
  // alterou. O modal mostra o principal; o PR completo pode commitar todos.
  changedFiles?: { file: string; originalCode: string; fixedCode: string }[];
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  branch: string;
}

// ---- Orquestração (job das 4 fases) ----
export interface PhaseState<T = unknown> {
  key: PhaseKey;
  /**
   * Rótulo INTERNO ("Plan · Modelagem de ameaças"), gravado no JSONB para
   * inspeção do banco. A tela nunca o lê — o stepper e a tela de resultados
   * usam as chaves `pipe.*`, que seguem o idioma. Se um dia isto for exibido,
   * precisa virar chave antes. Ver AUDITORIA.md#FEAT-04.
   */
  label: string;
  status: StepStatus;
  ai?: StepAIConfig;
  engines?: string[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: T;
}

export interface JobInput {
  projectName: string;
  systemDescription: string;
  repoUrl?: string;
  token?: string; // só em memória durante o job; nunca serializado ao cliente
  skills?: { name: string; content: string }[];
}

// Visão do job segura para o cliente (sem token nem conteúdo das skills).
export interface JobInputPublic {
  projectName: string;
  systemDescription: string;
  repoUrl?: string;
  hasToken: boolean;
  skillNames: string[];
  /**
   * Analisadores escolhidos nesta análise.
   *
   * A tela precisa disto para distinguir uma aba vazia porque nada foi
   * encontrado de uma aba vazia porque ninguém pediu aquela análise — a mesma
   * distinção do UX-15, agora no eixo da seleção. Linha antiga é lida como
   * "todos", que é o que ela de fato rodou.
   */
  selected: AnalyzerId[];
}

/**
 * Resultado da Fase 4. Sai vazio do job: a fase não gera mais correção
 * automática (AUDITORIA.md#BUG-16). Os campos continuam porque o relatório e
 * a tela leem daqui o que foi feito sob demanda.
 */
export interface RefactorResult {
  fixes: FixResult[];
  prs: PullRequest[];
}

export interface Job {
  id: string;
  createdAt: number;
  input: JobInputPublic;
  progress: number; // 0..100
  phases: {
    plan: PhaseState<ThreatModel>;
    skills: PhaseState<SkillValidation[]>;
    software: PhaseState<ScanResult>;
    refactor: PhaseState<RefactorResult>;
  };
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// `SEVERITY_LABEL_PT` vivia aqui e era a evidência citada no FEAT-04 ("enums
// de domínio viram chave de tradução, não string"). O último consumidor era o
// relatório; hoje a severidade vira rótulo por `severityKey()` +
// `severity.*` no dicionário. Ver AUDITORIA.md#PEND-23.
