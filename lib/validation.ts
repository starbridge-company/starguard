// ============================================================
// Validação de entrada (Zod) para TODAS as rotas + guardas anti-SSRF.
// Regra: nenhuma rota confia em body/query/params sem passar por aqui.
// ============================================================
import { z } from "zod";

// E-mail e URL validados por refine (independente de versão do zod).
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const emailField = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .refine((v) => emailRe.test(v), "email inválido");

// ---- SSRF: só github.com, sem IPs internos ----
const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fc|\[?fd)/i;

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  url: string;
}

export function parseGitHubRepo(input: string): GitHubRepoRef | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  if (PRIVATE_HOST_RE.test(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo)) {
    return null;
  }
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export const githubUrlField = z
  .string()
  .trim()
  .max(300)
  .refine((v) => parseGitHubRepo(v) !== null, "URL de repositório GitHub inválida");

// UUID v4/v5 (independente da versão do zod).
const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuidField = z
  .string()
  .trim()
  .refine((v) => uuidRe.test(v), "id inválido");

// ---- Schemas por rota ----
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
});

export const skillItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(200_000),
});

export const analyzeSchema = z.object({
  projectName: z.string().trim().min(1).max(200),
  systemDescription: z.string().trim().min(1).max(50_000),
  repoUrl: z.union([githubUrlField, z.literal("")]).optional(),
  token: z.string().max(500).optional(),
  // Usar um token salvo na conta (id) em vez de digitar um novo.
  tokenId: uuidField.optional(),
  // Ao digitar um token novo: salvá-lo na conta (cifrado) com este nome.
  saveToken: z.boolean().optional(),
  tokenName: z.string().trim().max(100).optional(),
  skills: z.array(skillItemSchema).max(20).optional(),
});

// Cadastro de token do GitHub na conta.
export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  token: z.string().trim().min(8).max(500),
});

// Criação de usuário (somente superadmin). Papel escolhido no ato.
export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailField,
  password: z.string().min(8).max(200),
  role: z.enum(["superadmin", "admin"]),
});

// Alteração de papel de um usuário (somente superadmin).
export const roleUpdateSchema = z.object({
  role: z.enum(["superadmin", "admin"]),
});

// Atualização do próprio perfil (nome, login/e-mail, senha). Alterar e-mail ou
// senha exige a senha atual (verificada na rota).
export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: emailField.optional(),
    currentPassword: z.string().max(200).optional(),
    newPassword: z.string().min(8).max(200).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.email !== undefined ||
      d.newPassword !== undefined,
    "nada para atualizar"
  );

export const step1Schema = z.object({
  systemDescription: z.string().trim().min(1).max(50_000),
});

export const step2Schema = z.object({
  skills: z.array(skillItemSchema).min(1).max(20),
});

export const step3Schema = z.object({
  repoUrl: githubUrlField,
  token: z.string().max(500).optional(),
  // Contexto para a revisão por IA (regra de negócio); ambos opcionais.
  systemDescription: z.string().trim().max(50_000).optional(),
  requirements: z.array(z.string()).max(200).optional(),
});

export const step4Schema = z.object({
  vulnerabilityId: z.string().min(1).max(120),
  file: z.string().min(1).max(500),
  originalCode: z.string().min(1).max(50_000),
  description: z.string().min(1).max(5_000),
  suggestion: z.string().max(5_000).optional(),
  language: z.string().max(40).optional(),
  // Contexto do erro + arquivo inteiro + prompt personalizado (Fase 4 real).
  line: z.number().int().min(0).max(10_000_000).optional(),
  endLine: z.number().int().min(0).max(10_000_000).optional(),
  // Regras do Opengrep costumam mandar o TÍTULO completo do CWE/OWASP, não só o id.
  cwe: z.string().max(300).optional(),
  owasp: z.string().max(300).optional(),
  ruleId: z.string().max(300).optional(),
  repoUrl: z.union([githubUrlField, z.literal("")]).optional(),
  userInstructions: z.string().max(4_000).optional(),
  // Achado persistido: habilita reaproveitar a correção já gerada em vez de
  // queimar IA de novo. Ver AUDITORIA.md#FEAT-02.
  findingId: uuidField.optional(),
  // "Refazer": ignora o cache e gera de novo (guardando a anterior).
  force: z.boolean().optional(),
  // Demais achados do MESMO arquivo, corrigidos na mesma passada — evita que
  // uma correção sobrescreva a outra no PR. Ver AUDITORIA.md#BUG-06.
  alsoFix: z
    .array(
      z.object({
        vulnerabilityId: z.string().min(1).max(120),
        description: z.string().min(1).max(5_000),
        suggestion: z.string().max(5_000).optional(),
        line: z.number().int().min(0).max(10_000_000).optional(),
        endLine: z.number().int().min(0).max(10_000_000).optional(),
        cwe: z.string().max(300).optional(),
        owasp: z.string().max(300).optional(),
        ruleId: z.string().max(300).optional(),
      })
    )
    .max(20)
    .optional(),
});

// Estado de um achado (marcar como corrigido / falso positivo / etc.).
export const findingStatusSchema = z.object({
  status: z.enum([
    "open",
    "fixed",
    "pr_open",
    "pr_merged",
    "false_positive",
    "accepted_risk",
  ]),
  note: z.string().trim().max(1_000).optional(),
});

export const cloneSchema = z.object({
  repoUrl: githubUrlField,
  token: z.string().max(500).optional(),
});

export const prSchema = z.object({
  repoUrl: githubUrlField,
  file: z.string().min(1).max(500),
  fixedCode: z.string().min(1).max(50_000),
  title: z.string().min(1).max(200),
  body: z.string().max(10_000).optional(),
  token: z.string().max(500).optional(),
  tokenId: uuidField.optional(),
  analysisId: uuidField.optional(),
});

// PR consolidado: várias correções commitadas numa única branch/PR.
export const prBatchSchema = z.object({
  repoUrl: githubUrlField,
  files: z
    .array(
      z.object({
        file: z.string().min(1).max(500),
        fixedCode: z.string().min(1).max(50_000),
      })
    )
    .min(1)
    .max(50),
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).optional(),
  token: z.string().max(500).optional(),
  tokenId: uuidField.optional(),
  analysisId: uuidField.optional(),
});

// ---- Helper ----
export type Validated<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export function validate<T>(
  schema: z.ZodType<T>,
  data: unknown
): Validated<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  return {
    ok: false,
    message: first ? `${first.path.join(".")}: ${first.message}` : "entrada inválida",
  };
}
