// ============================================================
// Repositório de achados e das correções geradas para eles. NODE-ONLY.
//
// É o que transforma o StarGuard de "relatório" em ferramenta de
// acompanhamento: o achado passa a ter estado próprio (aberto, corrigido,
// falso positivo…) e esse estado ATRAVESSA análises do mesmo repositório.
// Ver AUDITORIA.md#FEAT-01 e #FEAT-02.
// ============================================================
import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  findings,
  findingFixes,
  analyses,
  type FindingRow,
  type FindingStatus,
  type NewFinding,
} from "@/db/schema";
import {
  vulnerabilityFingerprint,
  dependencyFingerprint,
} from "@/lib/fingerprint";
import type { ScanResult, Vulnerability, DependencyVuln, FixResult } from "@/types";

/** Estados que significam "resolvido" — herdados por análises seguintes. */
const RESOLVED: FindingStatus[] = [
  "fixed",
  "false_positive",
  "accepted_risk",
  "pr_merged",
];

export interface FindingView {
  id: string;
  localId: string;
  status: FindingStatus;
  statusNote: string | null;
  statusAt: Date | null;
  inherited: boolean;
  hasFix: boolean;
}

function toRow(
  analysisId: string,
  userId: string,
  repoUrl: string | null,
  f: Vulnerability | DependencyVuln,
  fingerprint: string
): NewFinding {
  const isDep = f.source === "sca";
  const v = f as Vulnerability;
  const d = f as DependencyVuln;
  return {
    analysisId,
    userId,
    localId: f.id,
    fingerprint,
    repoUrl,
    source: f.source,
    ruleId: isDep ? d.cve : v.ruleId || "",
    severity: f.severity,
    file: isDep ? null : v.file,
    line: isDep ? null : v.line,
    title: f.title,
    payload: f as unknown as Record<string, unknown>,
  };
}

/**
 * Grava os achados de uma análise, herdando o estado de análises anteriores do
 * MESMO repositório e usuário. Idempotente por (analysis_id, local_id).
 */
export async function persistScanFindings(
  analysisId: string,
  userId: string,
  repoUrl: string | null,
  scan: ScanResult
): Promise<number> {
  const items: { f: Vulnerability | DependencyVuln; fp: string }[] = [
    ...scan.sast.vulnerabilities.map((v) => ({
      f: v as Vulnerability | DependencyVuln,
      fp: vulnerabilityFingerprint(v),
    })),
    ...(scan.review?.findings || []).map((v) => ({
      f: v as Vulnerability | DependencyVuln,
      fp: vulnerabilityFingerprint(v),
    })),
    ...scan.sca.dependencies.map((d) => ({
      f: d as Vulnerability | DependencyVuln,
      fp: dependencyFingerprint(d),
    })),
  ];
  if (!items.length) return 0;

  const rows = items.map(({ f, fp }) => toRow(analysisId, userId, repoUrl, f, fp));

  // Estado anterior de cada impressão digital, no mesmo repositório. Só o
  // registro mais recente conta.
  const inherited = new Map<string, { status: FindingStatus; id: string; note: string | null }>();
  if (repoUrl) {
    const prev = await db
      .select({
        fingerprint: findings.fingerprint,
        status: findings.status,
        id: findings.id,
        statusNote: findings.statusNote,
        createdAt: findings.createdAt,
      })
      .from(findings)
      .where(
        and(
          eq(findings.userId, userId),
          eq(findings.repoUrl, repoUrl),
          inArray(
            findings.fingerprint,
            items.map((i) => i.fp)
          )
        )
      )
      .orderBy(desc(findings.createdAt));

    for (const p of prev) {
      if (inherited.has(p.fingerprint)) continue; // já pegamos o mais recente
      if (RESOLVED.includes(p.status)) {
        inherited.set(p.fingerprint, {
          status: p.status,
          id: p.id,
          note: p.statusNote,
        });
      }
    }
  }

  const withState = rows.map((r) => {
    const prev = inherited.get(r.fingerprint);
    if (!prev) return r;
    return {
      ...r,
      status: prev.status,
      statusNote: prev.note,
      statusAt: new Date(),
      inheritedFrom: prev.id,
    };
  });

  await db.insert(findings).values(withState).onConflictDoNothing({
    target: [findings.analysisId, findings.localId],
  });

  return inherited.size;
}

/** Achados de uma análise, no formato que a tela consome (mapa por localId). */
export async function listForAnalysis(analysisId: string): Promise<FindingView[]> {
  const rows = await db
    .select({
      id: findings.id,
      localId: findings.localId,
      status: findings.status,
      statusNote: findings.statusNote,
      statusAt: findings.statusAt,
      inheritedFrom: findings.inheritedFrom,
    })
    .from(findings)
    .where(eq(findings.analysisId, analysisId));

  if (!rows.length) return [];

  // Quem tem correção guardada, numa segunda consulta. Uma subconsulta
  // correlacionada via template `sql` devolvia zero para todos — explícito
  // aqui é mais longo, mas é verificável e não depende de como o Drizzle
  // interpola a referência de coluna.
  const fixed = await db
    .select({ findingId: findingFixes.findingId })
    .from(findingFixes)
    .where(
      and(
        inArray(
          findingFixes.findingId,
          rows.map((r) => r.id)
        ),
        isNull(findingFixes.supersededAt)
      )
    );
  const withFix = new Set(fixed.map((f) => f.findingId));

  return rows.map((r) => ({
    id: r.id,
    localId: r.localId,
    status: r.status,
    statusNote: r.statusNote,
    statusAt: r.statusAt,
    inherited: !!r.inheritedFrom,
    hasFix: withFix.has(r.id),
  }));
}

export async function getById(id: string): Promise<FindingRow | undefined> {
  const rows = await db.select().from(findings).where(eq(findings.id, id)).limit(1);
  return rows[0];
}

export async function setStatus(
  id: string,
  status: FindingStatus,
  by: string,
  note?: string
): Promise<void> {
  await db
    .update(findings)
    .set({
      status,
      statusNote: note ?? null,
      statusBy: by,
      statusAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(findings.id, id));
}

// ------------------------------------------------------------
// Correções geradas
// ------------------------------------------------------------

/** Última correção válida (não substituída) de um achado. */
export async function getLatestFix(
  findingId: string
): Promise<(FixResult & { id: string; createdAt: Date }) | undefined> {
  const rows = await db
    .select()
    .from(findingFixes)
    .where(and(eq(findingFixes.findingId, findingId), isNull(findingFixes.supersededAt)))
    .orderBy(desc(findingFixes.createdAt))
    .limit(1);
  const r = rows[0];
  if (!r) return undefined;

  const finding = await getById(findingId);
  return {
    id: r.id,
    createdAt: r.createdAt,
    vulnerabilityId: finding?.localId || "",
    file: (finding?.file as string) || "",
    originalCode: r.originalCode,
    fixedCode: r.fixedCode,
    explanation: r.explanation || "",
    engine: (r.engine as "api" | "agent") || "api",
    changedFiles: r.changedFiles ?? undefined,
    noChange: r.noChange === 1,
    usedWholeFile: true,
  };
}

/** Grava uma correção, aposentando a anterior (histórico preservado). */
export async function saveFix(
  findingId: string,
  fix: FixResult,
  opts: { model?: string; instructions?: string; by?: string }
): Promise<void> {
  await db
    .update(findingFixes)
    .set({ supersededAt: new Date() })
    .where(and(eq(findingFixes.findingId, findingId), isNull(findingFixes.supersededAt)));

  await db.insert(findingFixes).values({
    findingId,
    engine: fix.engine || "api",
    model: opts.model,
    instructions: opts.instructions,
    originalCode: fix.originalCode,
    fixedCode: fix.fixedCode,
    changedFiles: fix.changedFiles,
    explanation: fix.explanation,
    noChange: fix.noChange ? 1 : 0,
    createdBy: opts.by,
  });
}

/** Dono da análise à qual o achado pertence (checagem de acesso nas rotas). */
export async function ownerOfFinding(findingId: string): Promise<string | undefined> {
  const rows = await db
    .select({ userId: analyses.userId })
    .from(findings)
    .innerJoin(analyses, eq(analyses.id, findings.analysisId))
    .where(eq(findings.id, findingId))
    .limit(1);
  return rows[0]?.userId;
}
