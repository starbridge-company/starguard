// ============================================================
// O worker da fila.
//
// Roda dentro do próprio processo Next, num laço com pausa. Não é a solução de
// escala — essa seria um processo separado, e o desenho aqui não impede isso
// (basta chamar `iniciarWorker` de um `node worker.mjs`). É a solução que
// funciona com a infraestrutura que existe hoje, e é honestamente melhor que o
// `fire-and-forget` que havia antes: o trabalho sobrevive a um restart, porque
// está no banco e não na memória.
//
// Um detalhe que evita um bug clássico: o laço só começa DEPOIS de uma
// requisição chegar (`instrumentation.ts`), e há trava por processo. Sem ela,
// o HMR do desenvolvimento subiria um worker novo a cada recarga de módulo e
// vários competiriam pela mesma fila.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import crypto from "node:crypto";
import { concluir, falhar, pegarProximo, type JobRow } from "@/lib/queue";
import { log, timed } from "@starguard/core/logger";
import { redactError } from "@starguard/core/redact";

/** Pausa entre varreduras quando a fila está vazia. */
const OCIOSO_MS = Number(process.env.QUEUE_POLL_MS || 5_000);

/** Identifica esta instância nos logs e no `locked_by`. */
const WORKER_ID = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

type Handler = (job: JobRow) => Promise<void>;

const HANDLERS: Record<string, () => Promise<Handler>> = {
  // Import dinâmico: o handler de análise puxa o orquestrador inteiro, e o
  // worker não pode pagar esse custo só por existir.
  analysis: async () => (await import("@/lib/handlers/analysis")).handleAnalysis,
  webhook: async () => (await import("@/lib/handlers/webhook")).handleWebhook,
};

const g = globalThis as unknown as { __sg_worker?: boolean };

/**
 * Sobe o laço uma vez por processo.
 *
 * A trava em `globalThis` sobrevive ao HMR: sem ela, cada recarga de módulo em
 * desenvolvimento acrescentaria um laço, e vários workers no mesmo processo
 * disputariam a fila (o `SKIP LOCKED` os impediria de duplicar trabalho, mas
 * o desperdício de conexão e log seria real).
 */
export function iniciarWorker(): void {
  if (g.__sg_worker) return;
  if (process.env.QUEUE_WORKER === "off") {
    log.info("worker.disabled", {});
    return;
  }
  g.__sg_worker = true;
  log.info("worker.start", { engine: WORKER_ID });
  void laco();
}

async function laco(): Promise<void> {
  for (;;) {
    let pegou = false;
    try {
      pegou = await umaVolta();
    } catch (e) {
      // Falha ao FALAR com a fila (banco fora do ar). O laço não pode morrer
      // por isso — se morresse, seria preciso reiniciar o processo para a fila
      // voltar a andar.
      log.error("worker.loop.failed", { error: e });
    }
    // Só dorme quando não havia nada: com fila cheia, processa em sequência
    // sem esperar 5 s entre um job e outro.
    if (!pegou) await dormir(OCIOSO_MS);
  }
}

async function umaVolta(): Promise<boolean> {
  const job = await pegarProximo(WORKER_ID);
  if (!job) return false;

  const handlerFactory = HANDLERS[job.kind];
  if (!handlerFactory) {
    // Tipo desconhecido não deve ficar girando na fila até esgotar tentativas:
    // nenhuma tentativa vai fazer aparecer um handler que não existe.
    await falhar({ ...job, attempts: job.maxAttempts }, `Tipo de job desconhecido: ${job.kind}`);
    return true;
  }

  try {
    const handler = await handlerFactory();
    await timed("job", { jobId: job.id, phase: job.kind }, () => handler(job));
    await concluir(job.id);
  } catch (e) {
    // Redigido: a mensagem é PERSISTIDA em `last_error` e aparece no
    // monitoramento; erro de ferramenta externa pode carregar credencial.
    // Ver AUDITORIA.md#SEC-01.
    await falhar(job, redactError(e));
  }
  return true;
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
