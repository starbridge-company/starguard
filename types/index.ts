// ============================================================
// StarGuard — tipos de domínio compartilhados (frontend + API)
// ============================================================

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type StepStatus = "pending" | "running" | "done" | "error";

export type PhaseKey = "plan" | "skills" | "software" | "refactor";

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
}

export interface SkillValidation {
  skillName: string;
  verdict: SkillVerdict;
  findings: SkillFinding[];
  checkedItems: { label: string; ok: boolean }[];
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
    refactor: PhaseState<{ fixes: FixResult[]; prs: PullRequest[] }>;
  };
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const SEVERITY_LABEL_PT: Record<Severity, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  info: "Info",
};
