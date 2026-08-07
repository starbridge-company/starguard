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

/** Teto da espera quando a fila está INALCANÇÁVEL (banco fora do ar). */
const BACKOFF_MAX_MS = Number(process.env.QUEUE_BACKOFF_MAX_MS || 60_000);

/**
 * Quanto esperar depois de `falhas` tentativas seguidas de falar com a fila.
 *
 * Sem isto, o laço mantém a cadência de fila vazia contra um banco que não
 * responde. Medido no deploy de 07/08/2026: a cada 15 segundos (5 s de pausa +
 * 10 s de `connectionTimeoutMillis`), uma entrada de log com vinte linhas de
 * SQL. Em uma hora, 240 delas — o suficiente para esconder qualquer outra coisa
 * que o servidor tivesse a dizer, inclusive a mensagem do boot que explica o
 * problema.
 *
 * Exponencial com teto de um minuto: um banco que volta é reencontrado em no
 * máximo um minuto (ninguém está esperando por isso — a fila tem `run_after`,
 * não perde trabalho), e um banco que não volta custa 60 tentativas por hora em
 * vez de 240.
 */
export function pausaAposFalha(falhas: number): number {
  if (falhas < 1) return OCIOSO_MS;
  return Math.min(OCIOSO_MS * 2 ** (falhas - 1), BACKOFF_MAX_MS);
}

/**
 * Esta falha vai para o log?
 *
 * Só a 1ª e depois nas potências de dois (1, 2, 4, 8, 16…). O primeiro registro
 * é o que interessa — traz o erro inteiro, no momento em que o problema começou
 * — e os seguintes são idênticos a ele. Rarear em vez de calar mantém a prova
 * de que ainda está fora do ar, sem transformar o log num muro.
 *
 * Com o backoff acima, "ainda fora" aparece na 1ª, 2ª, 4ª… tentativa: umas 10
 * linhas na primeira hora, contra 240.
 */
export function deveRegistrarFalha(falhas: number): boolean {
  if (falhas < 1) return false;
  return (falhas & (falhas - 1)) === 0;
}

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
  // Falhas SEGUIDAS ao falar com a fila. Zera na primeira volta que dá certo —
  // inclusive a que não encontra job nenhum, que também é uma conversa com o
  // banco bem-sucedida.
  let falhas = 0;

  for (;;) {
    let pegou = false;
    try {
      pegou = await umaVolta();
      falhas = 0;
    } catch (e) {
      // Falha ao FALAR com a fila (banco fora do ar). O laço não pode morrer
      // por isso — se morresse, seria preciso reiniciar o processo para a fila
      // voltar a andar.
      falhas++;
      if (deveRegistrarFalha(falhas)) {
        // `consecutive` é o que diz "isto não é um soluço": na 1ª linha ainda
        // pode ser oscilação; na 64ª é configuração errada, e quem lê precisa
        // dessa diferença sem ter de contar linhas repetidas.
        log.error("worker.loop.failed", { error: e, consecutive: falhas });
      }
      await dormir(pausaAposFalha(falhas));
      continue;
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
