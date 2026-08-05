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
import type { AnalyzerId, Job } from "@/types";

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
    // Idioma preferido. Sem isto o idioma vivia só no cookie e entrar de
    // outra máquina voltava ao padrão. Ver AUDITORIA.md#PEND-19.
    locale: text("locale"),
    // Corte de sessão: todo refresh token emitido ANTES deste instante é
    // recusado. É como um papel alterado, uma exclusão ou uma troca de senha
    // derrubam sessões em aberto sem precisar listar jti a jti.
    // Ver AUDITORIA.md#SEC-02 e #SEC-03.
    sessionsInvalidatedAt: timestamp("sessions_invalidated_at", {
      withTimezone: true,
    }),
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
    /**
     * Analisadores escolhidos nesta execução.
     *
     * NULL nas linhas antigas, e é assim que fica: elas rodaram as quatro
     * fases sempre, que é o mesmo que ter escolhido todos. `lib/jobs.ts` lê
     * `null` como "todos" — reescrever histórico só para registrar o óbvio
     * seria mexer em dado de produção sem ganho.
     *
     * Vale ficar registrado porque a tela precisa saber, meses depois, se uma
     * aba está vazia por não ter achado nada ou por não ter sido pedida.
     */
    selected: jsonb("selected").$type<AnalyzerId[]>(),
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

// ---- findings (achado individual, com estado próprio) ----
// Antes, os achados só existiam dentro do JSONB `analyses.phases`: não havia
// como marcar um como corrigido/falso positivo, nem reconhecê-lo num novo scan.
// Ver AUDITORIA.md#FEAT-01.
export const findingStatusEnum = starguard.enum("finding_status", [
  "open",
  "fixed",
  "pr_open",
  "pr_merged",
  "false_positive",
  "accepted_risk",
]);

export const findings = starguard.table(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // Id posicional dentro da análise ("V-3", "AI-1", "D-7"). É o que a tela
    // usa para casar o card com a linha — os ids do JSONB continuam válidos
    // DENTRO de uma análise, só não sobrevivem a um novo scan.
    localId: text("local_id").notNull(),
    // Identidade estável entre análises: regra + arquivo + trecho normalizado,
    // SEM a linha (código deslocado não pode ressuscitar achado resolvido).
    fingerprint: text("fingerprint").notNull(),
    repoUrl: text("repo_url"),
    source: text("source").notNull(), // sast | sca | ai-review
    ruleId: text("rule_id").notNull(),
    severity: text("severity").notNull(),
    file: text("file"),
    line: integer("line"),
    title: text("title").notNull(),
    // O Vulnerability/DependencyVuln completo, para a tela não depender do JSONB.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: findingStatusEnum("status").notNull().default("open"),
    statusNote: text("status_note"),
    statusBy: uuid("status_by").references(() => users.id),
    statusAt: timestamp("status_at", { withTimezone: true }),
    // Preenchido quando o estado veio de uma análise anterior do mesmo repo.
    inheritedFrom: uuid("inherited_from"),
    pullRequestId: uuid("pull_request_id").references(() => pullRequests.id),
    ...timestamps,
  },
  (t) => [
    index("findings_analysis_idx").on(t.analysisId, t.severity),
    index("findings_fp_idx").on(t.userId, t.fingerprint),
    uniqueIndex("findings_analysis_local_uidx").on(t.analysisId, t.localId),
  ]
);

// ---- finding_fixes (correções geradas, preservadas) ----
// A correção gerada morria no estado do React: fechar o modal e reabrir
// disparava uma nova chamada de IA. Ver AUDITORIA.md#FEAT-02.
export const findingFixes = starguard.table(
  "finding_fixes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id),
    engine: text("engine").notNull(), // api | agent
    model: text("model"),
    instructions: text("instructions"), // prompt personalizado usado
    originalCode: text("original_code").notNull(),
    fixedCode: text("fixed_code").notNull(),
    changedFiles: jsonb("changed_files").$type<
      { file: string; originalCode: string; fixedCode: string }[]
    >(),
    explanation: text("explanation"),
    noChange: integer("no_change").notNull().default(0), // 0/1
    createdBy: uuid("created_by").references(() => users.id),
    // Preenchido quando o usuário manda refazer: guardamos o histórico em vez
    // de sobrescrever, para dar pra comparar tentativas.
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("finding_fixes_finding_idx").on(t.findingId, t.supersededAt)]
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

// ---- oauth_codes (código de autorização, PKCE) ----
//
// O código vive 60 segundos e é de uso ÚNICO. Guardamos o HASH dele, nunca o
// código: pelo mesmo motivo que senha é hasheada — um dump do banco não pode
// render credencial utilizável.
//
// A linha guarda tudo a que o código está amarrado (`client_id`,
// `redirect_uri`, `code_challenge`). Na troca, os três são reconferidos contra
// o que o cliente apresenta; qualquer divergência recusa. Sem essa amarração, um
// código interceptado valeria para outro cliente ou outro destino.
export const oauthCodes = starguard.table(
  "oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    /** Desafio PKCE (S256). O `plain` é recusado antes de chegar aqui. */
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Preenchido no resgate. Não-nulo = já usado; apresentar de novo recusa. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("oauth_codes_expires_idx").on(t.expiresAt)]
);

// ---- oauth_sessions (sessão de cliente público: VS Code, CLI) ----
//
// Uma linha por dispositivo conectado. É o que sustenta três coisas de uma vez:
//
//  1. ROTAÇÃO com detecção de reuso. Cada refresh emite um novo token e grava o
//     `current_jti`. Se chegar um refresh cuja `family_id` existe mas cujo
//     `jti` NÃO é o corrente, alguém está repetindo um token antigo — ou seja,
//     roubado. A família inteira é revogada.
//  2. A tela "Dispositivos conectados", com revogar por dispositivo.
//  3. A trilha: `last_used_at` responde "esta credencial ainda é usada?".
//
// `family_id` é o que amarra todas as gerações de um mesmo login. Sem ela, a
// rotação seria só troca de token e o reuso passaria despercebido.
export const oauthSessions = starguard.table(
  "oauth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clientId: text("client_id").notNull(),
    familyId: uuid("family_id").notNull(),
    /** `jti` do refresh VÁLIDO agora. Qualquer outro da família é reuso. */
    currentJti: uuid("current_jti").notNull(),
    /** "VS Code · DESKTOP-XYZ" — o que a pessoa reconhece na lista. */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Por que foi revogada: pela pessoa, por reuso detectado, por logout. */
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("oauth_sessions_family_idx").on(t.familyId),
    index("oauth_sessions_user_idx").on(t.userId, t.createdAt.desc()),
    index("oauth_sessions_jti_idx").on(t.currentJti),
  ]
);

// ---- ai_usage (consumo de IA pela conta) ----
//
// Uma linha por CHAMADA, e nela **nenhum código**. Ficam gravados quem pediu,
// para quê, qual modelo, quantos tokens e quanto custou. O trecho analisado
// existe em memória durante a chamada e some; o diff da correção vive no PR do
// GitHub, que é onde ele já estaria.
//
// Essa é a decisão de retenção do produto, e ela tem consequência prática: um
// vazamento deste banco expõe padrões de uso, não o código dos clientes. Para
// uma ferramenta que analisa código proprietário, guardar os trechos seria
// transformar o servidor no alvo mais valioso da cadeia.
//
// `month` é desnormalizado (YYYY-MM) porque a cota é mensal e a checagem roda
// ANTES de cada chamada: somar por intervalo de data a cada requisição custaria
// uma varredura; com o índice composto, é uma busca.
export const aiUsage = starguard.table(
  "ai_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** "2026-08" — chave da janela de cota. */
    month: text("month").notNull(),
    /** De onde veio a chamada: "threat", "business", "refactor"… */
    purpose: text("purpose"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Custo em MILIONÉSIMOS de dólar: inteiro evita erro de ponto flutuante
     *  acumulado em milhares de chamadas pequenas. */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** Repositório, quando a chamada nasceu de uma análise. Só o nome. */
    repo: text("repo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // O índice que a checagem de cota usa: soma do mês, por usuário.
    index("ai_usage_user_month_idx").on(t.userId, t.month),
    index("ai_usage_created_idx").on(t.createdAt.desc()),
  ]
);

// ---- jobs (fila de execução) — AUDITORIA.md#ARQ-04 ----
//
// Até aqui o disparo era `fire-and-forget`: `/api/analyze` chamava `runJob` e
// não esperava. Isso tinha um custo já registrado (BUG-11: um restart do
// processo deixava a linha em `running` para sempre) e virou impedimento com o
// webhook — o GitHub espera resposta em segundos e a análise leva minutos.
//
// A fila é no PRÓPRIO Postgres, e não em Redis/SQS, por uma razão de tamanho:
// o banco já existe, já é transacional, e `FOR UPDATE SKIP LOCKED` resolve a
// disputa entre instâncias sem infraestrutura nova. Trocar por uma fila
// dedicada é decisão de escala, não de correção — e este schema não impede.
export const jobStatusEnum = starguard.enum("job_status", [
  "queued",
  "running",
  "done",
  "error",
  /** Excedeu as tentativas. Fica para inspeção, não é reprocessado sozinho. */
  "dead",
]);

export const jobs = starguard.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "analysis" | "webhook" — o que este job faz. */
    kind: text("kind").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    /** Payload do trabalho. NUNCA segredo: ver a nota em `lib/queue.ts`. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    userId: uuid("user_id").references(() => users.id),
    /**
     * Chave de deduplicação.
     *
     * O GitHub reenvia webhook quando não recebe 2xx a tempo, e um push
     * seguido de outro no mesmo PR não deve gerar duas análises concorrentes
     * do mesmo estado. Com índice único parcial (só entre os não terminados),
     * o segundo enfileiramento é descartado em vez de duplicar o trabalho.
     */
    dedupeKey: text("dedupe_key"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** Antes disto, ninguém pega. É o que dá backoff sem cron. */
    runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    /** Quem pegou. Um worker morto é detectado por `locked_at` velho. */
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // O índice que o `pegarProximo` usa: fila por prioridade de tempo.
    index("jobs_pending_idx").on(t.status, t.runAfter),
    index("jobs_created_idx").on(t.createdAt.desc()),
    index("jobs_dedupe_idx").on(t.dedupeKey),
  ]
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
export type FindingRow = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type FindingFixRow = typeof findingFixes.$inferSelect;
export type FindingStatus = FindingRow["status"];
export type Role = UserRow["role"];
export type OAuthCodeRow = typeof oauthCodes.$inferSelect;
export type NewOAuthCode = typeof oauthCodes.$inferInsert;
export type OAuthSessionRow = typeof oauthSessions.$inferSelect;
export type NewOAuthSession = typeof oauthSessions.$inferInsert;
