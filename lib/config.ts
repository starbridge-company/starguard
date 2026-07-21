// ============================================================
// Configuração central — mapa headless step -> { provider, model, engine }.
// Tudo trocável por env, sem tocar no código. As rotas NÃO referenciam
// provider/engine diretamente: passam pelo config + lib/ai.
// ============================================================
import type { AIProvider, PhaseKey, StepAIConfig } from "@/types";

export const DEMO_MODE = process.env.DEMO_MODE !== "false"; // default: true

const DEFAULT_PROVIDER = (process.env.AI_PROVIDER as AIProvider) || "anthropic";
const DEFAULT_MODEL = process.env.AI_MODEL || "claude-sonnet-5";

function stepAI(n: 1 | 2 | 3 | 4): StepAIConfig {
  const provider =
    (process.env[`STEP${n}_PROVIDER`] as AIProvider) || DEFAULT_PROVIDER;
  const model = process.env[`STEP${n}_MODEL`] || DEFAULT_MODEL;
  return { provider, model };
}

// Etapa -> configuração de IA (fase 3 não usa IA para escanear, mas usa para
// contextualizar os achados — reaproveita STEP3 se definido, senão o default).
export const AI_BY_PHASE: Record<Exclude<PhaseKey, never>, StepAIConfig> = {
  plan: stepAI(1),
  skills: stepAI(2),
  software: stepAI(3),
  refactor: stepAI(4),
};

export const ENGINES = {
  sast: (process.env.SAST_ENGINE || "opengrep").toLowerCase(),
  sca: (process.env.SCA_ENGINE || "trivy").toLowerCase(),
  dast: (process.env.DAST_ENGINE || "none").toLowerCase(),
  // Fase 4 (Correção): "agent" (padrão) = agente autônomo (Claude Agent SDK) que
  // lê o repo e edita os arquivos; "api" = disparo único na Claude API.
  // O agente é a via principal; a API entra como fallback silencioso se ele falhar.
  fix: (process.env.FIX_ENGINE || "agent").toLowerCase(),
};

// Parâmetros do engine de agente (só usados quando FIX_ENGINE=agent).
export const FIX_AGENT = {
  model: process.env.FIX_AGENT_MODEL || "",
  maxTurns: Number(process.env.FIX_AGENT_MAX_TURNS || 24),
  maxBudgetUsd: Number(process.env.FIX_AGENT_BUDGET_USD || 1),
  timeoutMs: Number(process.env.FIX_AGENT_TIMEOUT_MS || 270_000),
};

export const BIN = {
  semgrep: process.env.SEMGREP_BIN || "semgrep",
  opengrep: process.env.OPENGREP_BIN || "opengrep",
  trivy: process.env.TRIVY_BIN || "trivy",
};

// Ruleset do SAST (Opengrep/Semgrep). "auto" baixa regras do registro remoto
// (semgrep.dev) — exige rede + CA confiável. Aponte SAST_RULES para um diretório
// de regras local para rodar offline, sem depender de rede/SSL.
export const SAST_CONFIG = process.env.SAST_RULES || "auto";

// ---- Argon2id ----
export const ARGON = {
  memoryCost: Number(process.env.ARGON_MEMORY_KIB || 19456),
  timeCost: Number(process.env.ARGON_ITERATIONS || 3),
  parallelism: Number(process.env.ARGON_PARALLELISM || 1),
};

// ---- JWT ----
export const JWT = {
  accessTtl: process.env.JWT_ACCESS_TTL || "15m",
  refreshTtl: process.env.JWT_REFRESH_TTL || "7d",
  issuer: process.env.JWT_ISSUER || "starguard",
  audience: process.env.JWT_AUDIENCE || "starguard-web",
};

// ---- Cookies ----
export const SESSION_SECURE = process.env.SESSION_SECURE !== "false";
export const COOKIE = {
  access: "sg_at",
  refresh: "sg_rt",
  csrf: "sg_csrf",
};

// ---- Rate limit ----
export interface RateSpec {
  max: number;
  windowMs: number;
}

export function parseRate(spec: string, fallback: RateSpec): RateSpec {
  // formato "5/15m", "100/1m", "30/30s"
  const m = spec?.match(/^(\d+)\/(\d+)([smh])$/);
  if (!m) return fallback;
  const max = Number(m[1]);
  const n = Number(m[2]);
  const unit = m[3];
  const ms = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return { max, windowMs: n * ms };
}

export const LOGIN_RATE = parseRate(process.env.LOGIN_RATE_LIMIT || "5/15m", {
  max: 5,
  windowMs: 15 * 60_000,
});

export const API_RATE = parseRate(process.env.API_RATE_LIMIT || "100/1m", {
  max: 100,
  windowMs: 60_000,
});

// ---- Demo user ----
export const DEMO_USER = {
  email: process.env.DEMO_USER_EMAIL || "admin@starguard.local",
  password: process.env.DEMO_USER_PASSWORD || "StarGuard!2026",
  role: "Superadmin" as const,
};

// Resumo legível para exibir no header/relatório ("como está configurado agora").
export function engineSummary() {
  return {
    demo: DEMO_MODE,
    sast: ENGINES.sast,
    sca: ENGINES.sca,
    dast: ENGINES.dast,
    fix: ENGINES.fix,
    ai: AI_BY_PHASE,
  };
}
