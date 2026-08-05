// ============================================================
// Configuração do APP WEB — sessão, senha, cota de requisição, papéis e banco.
//
// A configuração do MOTOR (provedor de IA, orçamento de tokens, engines,
// caminho dos binários) mudou de endereço: mora em `@starguard/core/config`,
// porque o terminal e a extensão do VS Code precisam dela e não têm servidor
// web nenhum por perto. O `export *` abaixo mantém todos os importadores
// antigos funcionando — `import { ENGINES } from "@/lib/config"` continua
// certo, e continua devolvendo exatamente a mesma coisa.
//
// O que fica AQUI é o que só existe porque há um servidor HTTP: Argon2id, JWT,
// cookies, rate limit, RBAC e a semente do banco.
// ============================================================
export * from "@starguard/core/config";

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

// Cota de login por CONTA+IP, cobrada apenas em tentativa FALHA (a rota zera o
// balde no sucesso). É o freio contra força bruta numa conta específica.
export const LOGIN_RATE = parseRate(process.env.LOGIN_RATE_LIMIT || "10/10m", {
  max: 10,
  windowMs: 10 * 60_000,
});

// Cota por IP puro, bem mais larga: freia enumeração de contas (muitos e-mails
// diferentes a partir do mesmo lugar) sem punir quem só está entrando de novo.
export const LOGIN_IP_RATE = parseRate(process.env.LOGIN_IP_RATE_LIMIT || "30/10m", {
  max: 30,
  windowMs: 10 * 60_000,
});

export const API_RATE = parseRate(process.env.API_RATE_LIMIT || "100/1m", {
  max: 100,
  windowMs: 60_000,
});

// ---- Papéis (RBAC) ----
export const ROLES = {
  superadmin: "superadmin",
  admin: "admin",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

// ---- Banco de dados ----
export const DATABASE_URL = process.env.DATABASE_URL || "";

// ---- Usuários iniciais (seed idempotente; senha via Argon2id em runtime) ----
export const SEED_SUPERADMIN = {
  email: process.env.SEED_SUPERADMIN_EMAIL || "admin@starguard.local",
  password: process.env.SEED_SUPERADMIN_PASSWORD || "StarGuard!2026",
  name: "Super Admin",
  role: ROLES.superadmin,
};
export const SEED_ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL || "membro@starguard.local",
  password: process.env.SEED_ADMIN_PASSWORD || "StarGuard!2026",
  name: "Membro",
  role: ROLES.admin,
};
