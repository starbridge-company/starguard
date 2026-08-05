// ============================================================
// @starguard/core — a porta de entrada do motor.
//
// ATENÇÃO: este barril é NODE-ONLY. Importá-lo puxa o registro, e o registro
// puxa os cinco analisadores — que falam com `node:child_process`. Quem está
// no navegador deve importar o subcaminho específico:
//
//   @starguard/core/types      tipos de domínio (apagados na compilação)
//   @starguard/core/contracts  contratos do motor (só tipos)
//   @starguard/core/i18n       dicionários e tradução
//   @starguard/core/fix/deps   regras de correção de dependência (puras)
//
// O app web já faz isso: `@/types`, `@/lib/i18n` e `@/lib/deps-fix` apontam
// para os subcaminhos, e só as rotas de servidor importam daqui.
// ============================================================

// ---- Orquestração ----
export { plan, run, analyze, type PlanInput, type RunOptions } from "./orchestrator";
export { allAnalyzers, getAnalyzer, resolveSelection } from "./registry";
export { openWorkspace } from "./workspace";
export * from "./contracts";

// ---- Compatibilidade com o formato de fases gravado no banco ----
export {
  analyzerToPhase,
  phaseAnalyzers,
  phasesFrom,
  phaseStatusFrom,
  progressFrom,
  reasonKey,
  scanResultFrom,
  type PhaseSnapshot,
} from "./compat";

// ---- Domínio ----
export * from "./types";
export { parseGitHubRepo, looksLikeUrl, type GitHubRepoRef } from "./repo-url";

// ---- Configuração e diagnóstico ----
export {
  AI_BY_PHASE,
  BIN,
  ENGINES,
  FIX_AGENT,
  SAST_CONFIG,
  aiFor,
  aiForFix,
  aiHttp,
  engineSummary,
  maxTokensFor,
  maxTokensForFix,
  phaseMaxTokens,
} from "./config";
export { checkBinaries, probeBinary, clearProbeCache, type BinaryStatus } from "./binaries";
export { hasAnyAiKey, AIError, runAI, extractJSON } from "./ai";
export {
  setAiTransport,
  getAiTransport,
  usingRemoteAi,
  RemoteAiError,
  type AiTransport,
  type RemoteTransport,
} from "./ai-transport";

// ---- Repositório remoto ----
export {
  ScanUnavailable,
  cloneRepo,
  cleanup,
  fetchFileContent,
  getRepoMeta,
  isPrivateRepo,
  openPullRequest,
  openPullRequestBatch,
} from "./git";
export {
  GitHubTokenRequired,
  isSingleTenant,
  resolveGitHubToken,
  tokenForPullRequest,
} from "./github-auth";

// ---- Correção ----
export { generateFix, describeFindings, type FixInput, type ExtraFinding } from "./fix/code";
export { makeCodeFixer } from "./fix/code-fixer";
export { makeDepsFixer } from "./fix/deps-fixer";
export * from "./fix/deps";

// ---- Utilidades transversais ----
export { redact, redactError } from "./redact";
export { log, timed } from "./logger";
export { collidesWithSast, collidesWithSca, normPath } from "./dedup";
export { vulnerabilityFingerprint, dependencyFingerprint } from "./fingerprint";
export * from "./export";
export { enrichFindings, enrichDependencies } from "./enrich";
export * from "./constants";
