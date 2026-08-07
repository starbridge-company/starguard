// ============================================================
// Handler de job: rodar uma análise.
//
// Fino de propósito. Tudo o que decide alguma coisa já existe — o orquestrador
// em `@starguard/core`, a persistência em `lib/sinks/postgres.ts`, o ciclo de
// vida em `lib/jobs.ts`. Aqui só se traduz "um job da fila" em "uma chamada de
// `runJob`".
//
// O payload leva a REFERÊNCIA da análise, não os dados dela: os segredos
// (token do GitHub, conteúdo das skills) continuam no mapa em memória, e o
// payload da fila é gravado em claro no banco.
// ============================================================
import "server-only";
import type { JobRow } from "@/lib/queue";

export async function handleAnalysis(job: JobRow): Promise<void> {
  const analysisId = job.payload.analysisId;
  if (typeof analysisId !== "string") {
    throw new Error("Job de análise sem `analysisId` no payload.");
  }
  const { runJob } = await import("@/lib/jobs");
  await runJob(analysisId, job.payload.transient);
}
