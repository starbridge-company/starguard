// ============================================================
// Orquestração das 4 fases + store em memória (MVP).
// /api/analyze cria o job e dispara runJob (fire-and-forget); a Tela 2
// faz polling em /api/status/[id]. Token do GitHub vive só em memória
// durante o job e é apagado ao final.
// ============================================================
import "server-only";
import { DEMO_MODE, AI_BY_PHASE, ENGINES, FIX_AGENT } from "@/lib/config";
import {
  generateThreatModel,
  validateSkills,
  runScan,
  generateFix,
} from "@/lib/tasks";
import { demoFixes } from "@/lib/fixtures";
import { audit } from "@/lib/auth";
import type {
  Job,
  JobInput,
  PhaseKey,
  PhaseState,
  ScanResult,
  Vulnerability,
} from "@/types";
import { SEVERITY_ORDER } from "@/types";

interface Entry {
  job: Job;
  raw: JobInput;
}

const g = globalThis as unknown as { __sg_jobs?: Map<string, Entry> };
g.__sg_jobs ||= new Map();
const store = g.__sg_jobs!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO_DELAY: Record<PhaseKey, number> = {
  plan: 1200,
  skills: 1100,
  software: 1800,
  refactor: 1200,
};

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

export function createJob(raw: JobInput): Job {
  const id = `job_${crypto.randomUUID().slice(0, 8)}`;
  const job: Job = {
    id,
    createdAt: Date.now(),
    demo: DEMO_MODE,
    input: {
      projectName: raw.projectName,
      systemDescription: raw.systemDescription,
      repoUrl: raw.repoUrl,
      hasToken: !!raw.token,
      skillNames: (raw.skills || []).map((s) => s.name),
    },
    progress: 0,
    phases: {
      plan: newPhase("plan", "Plan · Modelagem de ameaças"),
      skills: newPhase("skills", "Code · Validação de Skills"),
      software: newPhase("software", "Code · Scan do software"),
      refactor: newPhase("refactor", "Refactor · Correção"),
    },
  };
  store.set(id, { job, raw });
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.get(id)?.job;
}

function topVulnerability(scan?: ScanResult): Vulnerability | undefined {
  if (!scan) return undefined;
  // Considera SAST + revisão por IA: uma violação crítica de regra de negócio
  // também pode virar a correção destacada da Fase 4.
  const pool = [...scan.sast.vulnerabilities, ...(scan.review?.findings || [])];
  return pool.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  )[0];
}

async function runPhase<T>(
  job: Job,
  key: PhaseKey,
  fn: () => Promise<T>
): Promise<void> {
  const ph = job.phases[key] as PhaseState<T>;
  ph.status = "running";
  ph.startedAt = Date.now();
  try {
    if (job.demo) await sleep(DEMO_DELAY[key]);
    ph.result = await fn();
    ph.status = "done";
  } catch (e) {
    ph.status = "error";
    ph.error = e instanceof Error ? e.message : "Falha na etapa.";
  } finally {
    ph.finishedAt = Date.now();
  }
}

export async function runJob(id: string): Promise<void> {
  const entry = store.get(id);
  if (!entry) return;
  const { job, raw } = entry;
  audit("analyze.start", { jobId: id, demo: job.demo });

  try {
    await runPhase(job, "plan", () =>
      generateThreatModel(raw.systemDescription)
    );
    job.progress = 25;

    await runPhase(job, "skills", () => validateSkills(raw.skills || []));
    job.progress = 50;

    await runPhase(job, "software", () =>
      runScan(raw.repoUrl, raw.token, {
        systemDescription: raw.systemDescription,
        // Requisitos da Fase 1 alimentam a validação de regra de negócio.
        requirements: job.phases.plan.result?.requirements,
      })
    );
    job.progress = 80;

    await runPhase(job, "refactor", async () => {
      if (job.demo) return demoFixes();
      const scan = job.phases.software.result;
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
    job.progress = 100;
    audit("analyze.done", { jobId: id });
  } finally {
    // Token só em memória durante o job.
    raw.token = undefined;
  }
}

/** Dispara a orquestração sem bloquear a resposta HTTP. */
export function startJob(id: string): void {
  void runJob(id).catch((e) => {
    console.error(`[job ${id}] erro inesperado`, e);
  });
}
