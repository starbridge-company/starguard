// ============================================================
// Orquestração das 4 fases + persistência no Postgres.
// /api/analyze cria a linha (status pending) e dispara runJob (fire-and-forget);
// a Tela 2 faz polling em /api/status/[id] (lê do BD). Segredos (token do
// GitHub decifrado + conteúdo das skills) vivem APENAS num mapa em memória
// durante o job e são apagados no fim — nunca são persistidos.
// ============================================================
import "server-only";
import { AI_BY_PHASE, ENGINES, FIX_AGENT, engineSummary } from "@/lib/config";
import {
  generateThreatModel,
  validateSkills,
  runScan,
  generateFix,
} from "@/lib/tasks";
import { audit } from "@/lib/auth";
import { redactError } from "@/lib/redact";
import * as analysesRepo from "@/lib/repos/analyses";
import * as tokensRepo from "@/lib/repos/tokens";
import * as findingsRepo from "@/lib/repos/findings";
import type { Locale } from "@/lib/i18n/config";
import type {
  Job,
  JobInput,
  JobInputPublic,
  PhaseKey,
  PhaseState,
  ScanResult,
  Severity,
  Vulnerability,
} from "@/types";
import { SEVERITY_ORDER } from "@/types";

// Segredos transitórios (nunca vão ao BD).
interface Transient {
  systemDescription: string;
  /** Idioma do usuário no momento da criação — o job roda destacado da
   *  requisição, então precisa carregar essa informação junto. */
  locale?: Locale;
  repoUrl?: string;
  token?: string;
  skills: { name: string; content: string }[];
}

const g = globalThis as unknown as { __sg_secrets?: Map<string, Transient> };
g.__sg_secrets ||= new Map();
const secrets = g.__sg_secrets!;

function engineLabels(phase: PhaseKey): string[] {
  const ai = AI_BY_PHASE[phase];
  if (phase === "software") return [ENGINES.sast, ENGINES.sca];
  if (phase === "refactor" && ENGINES.fix === "agent")
    return ["claude-code", FIX_AGENT.model || ai.model];
  return [`${ai.provider}`, ai.model];
}

function newPhase<T>(key: PhaseKey, label: string): PhaseState<T> {
  return {
    key,
    label,
    status: "pending",
    ai: AI_BY_PHASE[key],
    engines: engineLabels(key),
  };
}

function initialPhases(): Job["phases"] {
  return {
    plan: newPhase("plan", "Plan · Modelagem de ameaças"),
    skills: newPhase("skills", "Code · Validação de Skills"),
    software: newPhase("software", "Code · Scan do software"),
    refactor: newPhase("refactor", "Refactor · Correção"),
  };
}

/**
 * Resolve o token a usar: por id de token salvo (decifra) ou token inline.
 * Se pediram para salvar um token novo, persiste cifrado (best-effort).
 */
async function resolveToken(
  userId: string,
  input: {
    token?: string;
    tokenId?: string;
    saveToken?: boolean;
    tokenName?: string;
  }
): Promise<string | undefined> {
  if (input.tokenId) {
    const plain = await tokensRepo.getDecrypted(userId, input.tokenId);
    return plain ?? undefined;
  }
  if (input.token && input.saveToken && input.tokenName) {
    try {
      await tokensRepo.createToken(userId, input.tokenName, input.token);
    } catch {
      /* salvar o token não pode derrubar a análise */
    }
  }
  return input.token || undefined;
}

export interface CreateAnalysisInput extends JobInput {
  locale?: Locale;
  tokenId?: string;
  saveToken?: boolean;
  tokenName?: string;
}

/** Cria a análise no BD (status pending) e guarda os segredos em memória. */
export async function createAnalysis(
  userId: string,
  input: CreateAnalysisInput
): Promise<string> {
  const token = await resolveToken(userId, input);
  const id = await analysesRepo.createAnalysis({
    userId,
    projectName: input.projectName,
    systemDescription: input.systemDescription,
    repoUrl: input.repoUrl || null,
    engineSummary: engineSummary() as unknown as Record<string, unknown>,
    phases: initialPhases(),
  });
  secrets.set(id, {
    systemDescription: input.systemDescription,
    locale: input.locale,
    repoUrl: input.repoUrl || undefined,
    token,
    skills: input.skills || [],
  });
  return id;
}

/** Reconstrói o shape de Job (consumido por results/report) a partir da linha. */
export async function getAnalysis(id: string): Promise<Job | undefined> {
  const row = await analysesRepo.getById(id);
  if (!row) return undefined;
  const phases = (row.phases as Job["phases"]) ?? initialPhases();
  const skillNames = phases.skills?.result?.map((s) => s.skillName) ?? [];
  const input: JobInputPublic = {
    projectName: row.projectName,
    systemDescription: row.systemDescription,
    repoUrl: row.repoUrl ?? undefined,
    hasToken: false,
    skillNames,
  };
  return {
    id: row.id,
    createdAt: row.createdAt.getTime(),
    input,
    progress: row.progress,
    phases,
  };
}

/** Retorna o dono da análise (para checagem de acesso na rota). */
export async function getAnalysisOwner(id: string): Promise<string | undefined> {
  const row = await analysesRepo.getById(id);
  return row?.userId;
}

function topVulnerability(scan?: ScanResult): Vulnerability | undefined {
  if (!scan) return undefined;
  const pool = [...scan.sast.vulnerabilities, ...(scan.review?.findings || [])];
  return pool.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  )[0];
}

// `prsCount` fica de fora de propósito: quem o mantém é o repositório de PRs,
// que incrementa a cada PR aberto. Recalculá-lo aqui zeraria o contador, já
// que `phases.refactor.prs` está sempre vazio. Ver AUDITORIA.md#BUG-08.
function computeMetrics(
  phases: Job["phases"]
): Omit<analysesRepo.AnalysisMetrics, "prsCount"> {
  const scan = phases.software.result;
  const refactor = phases.refactor.result;
  const sast = scan?.sast.vulnerabilities ?? [];
  const sca = scan?.sca.dependencies ?? [];
  const review = scan?.review?.findings ?? [];
  const sev = (s: Severity) =>
    sast.filter((v) => v.severity === s).length +
    review.filter((v) => v.severity === s).length +
    sca.filter((d) => d.severity === s).length;
  return {
    criticalCount: sev("critical"),
    highCount: sev("high"),
    mediumCount: sev("medium"),
    lowCount: sev("low"),
    infoCount: sev("info"),
    sastCount: sast.length,
    scaCount: sca.length,
    reviewCount: review.length,
    fixesCount: refactor?.fixes.length ?? 0,
    totalFindings: sast.length + sca.length + review.length,
  };
}

async function runPhase<T>(
  phases: Job["phases"],
  id: string,
  key: PhaseKey,
  fn: () => Promise<T>
): Promise<void> {
  const ph = phases[key] as PhaseState<T>;
  ph.status = "running";
  ph.startedAt = Date.now();
  // Persiste o "running" para o polling refletir o andamento em tempo real.
  await analysesRepo
    .patchAnalysis(id, { phases, status: "running" })
    .catch(() => {});
  try {
    ph.result = await fn();
    ph.status = "done";
  } catch (e) {
    ph.status = "error";
    // Redigido: este texto é PERSISTIDO no JSONB e exibido na tela; erros de
    // ferramenta externa podem carregar credenciais (AUDITORIA.md#SEC-01).
    ph.error = redactError(e) || "Falha na etapa.";
  } finally {
    ph.finishedAt = Date.now();
  }
}

export async function runJob(id: string): Promise<void> {
  const raw = secrets.get(id);
  if (!raw) return;
  const phases = initialPhases();
  audit("analyze.start", { jobId: id });

  const persist = (progress: number) =>
    analysesRepo.patchAnalysis(id, { phases, progress }).catch(() => {});

  try {
    await analysesRepo
      .patchAnalysis(id, { status: "running", startedAt: new Date() })
      .catch(() => {});

    await runPhase(phases, id, "plan", () =>
      generateThreatModel(raw.systemDescription, raw.locale)
    );
    await persist(25);

    await runPhase(phases, id, "skills", () => validateSkills(raw.skills || []));
    await persist(50);

    await runPhase(phases, id, "software", () =>
      runScan(raw.repoUrl, raw.token, {
        systemDescription: raw.systemDescription,
        requirements: phases.plan.result?.requirements,
        locale: raw.locale,
      })
    );

    // Cada achado vira uma linha com estado próprio, herdando o que já foi
    // resolvido em análises anteriores do mesmo repositório. Falhar aqui não
    // pode derrubar a análise — o JSONB `phases` continua sendo a fonte dos
    // dados; a tabela é o que dá memória. Ver AUDITORIA.md#FEAT-01.
    const scanResult = phases.software.result;
    if (scanResult) {
      const userId = await analysesRepo
        .getById(id)
        .then((r) => r?.userId)
        .catch(() => undefined);
      if (userId) {
        await findingsRepo
          .persistScanFindings(id, userId, raw.repoUrl || null, scanResult)
          .then((herdados) => {
            if (herdados > 0) {
              console.log(`[job ${id}] ${herdados} achado(s) com estado herdado`);
            }
          })
          .catch((e) => console.error(`[job ${id}] falha ao gravar achados`, e));
      }
    }

    await persist(80);

    await runPhase(phases, id, "refactor", async () => {
      const scan = phases.software.result;
      const top = topVulnerability(scan);
      const fixes = top?.codeSnippet
        ? [
            await generateFix({
              vulnerabilityId: top.id,
              file: top.file,
              originalCode: top.codeSnippet,
              description: top.description || top.title,
              suggestion: top.suggestion,
            }),
          ]
        : [];
      return { fixes, prs: [] };
    });

    const anyError = (Object.values(phases) as PhaseState[]).some(
      (p) => p.status === "error"
    );
    await analysesRepo.patchAnalysis(id, {
      phases,
      progress: 100,
      status: anyError ? "error" : "done",
      finishedAt: new Date(),
      metrics: computeMetrics(phases),
    });
    audit("analyze.done", { jobId: id });
  } catch (e) {
    // Falha inesperada fora das fases: marca a análise como erro.
    await analysesRepo
      .patchAnalysis(id, {
        phases,
        status: "error",
        finishedAt: new Date(),
        metrics: computeMetrics(phases),
      })
      .catch(() => {});
    console.error(`[job ${id}] erro inesperado`, e);
  } finally {
    // Token e skills só vivem em memória durante o job.
    secrets.delete(id);
  }
}

/** Dispara a orquestração sem bloquear a resposta HTTP. */
export function startJob(id: string): void {
  void runJob(id).catch((e) => {
    console.error(`[job ${id}] erro inesperado`, e);
  });
}
