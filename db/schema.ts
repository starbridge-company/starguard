// ============================================================
// Schema Drizzle — TUDO vive no schema Postgres "starguard".
// pgSchema garante o namespace; enums e tabelas são criados dentro dele.
// Tipos são derivados daqui (table.$inferSelect/$inferInsert) — não duplicar
// os tipos de linha à mão.
// ============================================================
import {
  pgSchema,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  bigserial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Job } from "@/types";

// Namespace físico no Postgres. A migração gera `CREATE SCHEMA "starguard"`.
export const starguard = pgSchema("starguard");

// ---- Enums (dentro do schema) ----
export const roleEnum = starguard.enum("role", ["superadmin", "admin"]);
export const analysisStatusEnum = starguard.enum("analysis_status", [
  "pending",
  "running",
  "done",
  "error",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

// ---- users ----
export const users = starguard.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(), // sempre armazenado em minúsculas
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("admin"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_uidx").on(t.email),
    index("users_role_idx").on(t.role),
  ]
);

// ---- github_tokens (cifrados; múltiplos por usuário; soft delete) ----
export const githubTokens = starguard.table(
  "github_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(), // rótulo escolhido pelo usuário
    // AES-256-GCM (todos em base64). Nunca guardamos o token em claro.
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    last4: text("last4").notNull(), // só para exibir "…a1b2"
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("github_tokens_user_idx").on(t.userId, t.deletedAt)]
);

// ---- analyses (job das 4 fases, persistido) ----
export const analyses = starguard.table(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    projectName: text("project_name").notNull(),
    systemDescription: text("system_description").notNull(),
    repoUrl: text("repo_url"),
    status: analysisStatusEnum("status").notNull().default("pending"),
    progress: integer("progress").notNull().default(0),
    // Snapshot da config de engines/IA no momento da análise.
    engineSummary: jsonb("engine_summary").$type<Record<string, unknown>>(),
    // Mesmo shape de Job["phases"] — as telas results/report consomem direto.
    phases: jsonb("phases").$type<Job["phases"]>(),
    // Colunas de métrica desnormalizadas: permitem ordenar/filtrar/agregar
    // sem parsear JSON — chave da escalabilidade do dashboard e das listas.
    criticalCount: integer("critical_count").notNull().default(0),
    highCount: integer("high_count").notNull().default(0),
    mediumCount: integer("medium_count").notNull().default(0),
    lowCount: integer("low_count").notNull().default(0),
    infoCount: integer("info_count").notNull().default(0),
    sastCount: integer("sast_count").notNull().default(0),
    scaCount: integer("sca_count").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    fixesCount: integer("fixes_count").notNull().default(0),
    prsCount: integer("prs_count").notNull().default(0),
    totalFindings: integer("total_findings").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("analyses_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("analyses_status_idx").on(t.status),
    index("analyses_created_idx").on(t.createdAt.desc()),
  ]
);

// ---- pull_requests (PRs abertos a partir das correções) ----
export const pullRequests = starguard.table(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id").references(() => analyses.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    repoUrl: text("repo_url").notNull(),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    branch: text("branch").notNull(),
    committedCount: integer("committed_count").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index("pull_requests_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("pull_requests_analysis_idx").on(t.analysisId),
  ]
);

// ---- audit_log ----
export const auditLog = starguard.table(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id"),
    event: text("event").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("audit_created_idx").on(t.createdAt.desc()),
    index("audit_user_idx").on(t.userId, t.createdAt.desc()),
    index("audit_event_idx").on(t.event),
  ]
);

// ---- revoked_tokens (blocklist de refresh, multi-instância) ----
export const revokedTokens = starguard.table(
  "revoked_tokens",
  {
    jti: uuid("jti").primaryKey(),
    userId: uuid("user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("revoked_expires_idx").on(t.expiresAt)]
);

// ---- Tipos derivados ----
export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type GithubTokenRow = typeof githubTokens.$inferSelect;
export type NewGithubToken = typeof githubTokens.$inferInsert;
export type AnalysisRow = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type PullRequestRow = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type Role = UserRow["role"];
