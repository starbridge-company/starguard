// ============================================================
// Quantos scanners nativos podem rodar AO MESMO TEMPO nesta máquina.
//
// Isto existe porque a defesa que havia estava no lugar errado. A fila morava
// dentro de `app/api/scan/route.ts`, e por isso valia só para o scan da
// extensão: a análise pedida pelo PAINEL WEB executa `runSast`/`runSca` dentro
// do mesmo processo, por `lib/jobs.ts`, sem passar por rota nenhuma. As duas
// entradas disputavam a mesma caixa e só uma delas sabia disso — bastava
// alguém clicar "analisar" no navegador enquanto um editor escaneava para o
// opengrep e o trivy se encontrarem na memória de 512 MB. Ver ARQ-15.
//
// A vaga fica AQUI, no núcleo, colada em quem gasta o recurso. Toda entrada
// passa a atravessar o mesmo portão porque todas chamam `runSast`/`runSca` —
// não há como esquecer de enfileirar, que é o defeito que uma fila na borda
// sempre teve.
//
// **O padrão se auto-configura, e é isso que o mantém honesto.** O número de
// vagas considera CPU, memória e quantos filhos cada SAST já abre. Contar só
// núcleos duas vezes (`scans × --jobs`) multiplicava processos e RAM. Quem quer
// trocar isolamento por throughput ainda pode declarar `SCAN_SLOTS`.
//
// NODE-ONLY.
// ============================================================
import { scanSlotsSugeridos } from "./container";

/**
 * Vagas simultâneas. `SCAN_SLOTS` tem precedência: quem hospeda sabe da
 * própria caixa melhor que qualquer heurística.
 */
export function scanSlots(): number {
  const env = Number(process.env.SCAN_SLOTS);
  if (Number.isFinite(env) && env >= 1) return Math.floor(env);
  return scanSlotsSugeridos();
}

let emUso = 0;
/** Quem chegou e não coube. FIFO: a vaga vai para quem espera há mais tempo. */
const esperando: (() => void)[] = [];

/** Quantos scanners estão rodando agora. */
export function vagasEmUso(): number {
  return emUso;
}

/** Quantos estão esperando vaga. */
export function naFilaDeVagas(): number {
  return esperando.length;
}

/**
 * Roda `fn` ocupando uma vaga, e devolve a vaga aconteça o que acontecer.
 *
 * `aoEsperar` recebe a POSIÇÃO na fila (1 = próximo da vez). Não é enfeite: é a
 * diferença entre uma tela que diz "aguarde" e uma que diz quanto falta. Quem
 * não espera não é chamado — um aviso de fila para quem entrou direto seria
 * ruído que treina as pessoas a ignorar o aviso de verdade.
 */
export async function comVaga<T>(
  fn: () => Promise<T>,
  aoEsperar?: (posicao: number) => void
): Promise<T> {
  if (emUso >= scanSlots()) {
    aoEsperar?.(esperando.length + 1);
    await new Promise<void>((libera) => esperando.push(libera));
  }
  emUso++;
  try {
    return await fn();
  } finally {
    emUso--;
    // O `shift` é o que faz a fila ser FIFO. Um `pop` deixaria quem chegou
    // primeiro esperando indefinidamente enquanto os recém-chegados passam.
    esperando.shift()?.();
  }
}

/**
 * Devolve todas as vagas e solta quem espera. **Só para teste** — em produção
 * a vaga é devolvida pelo `finally`, e um reset por fora mascararia um
 * vazamento em vez de revelá-lo.
 */
export function resetScanSlots(): void {
  emUso = 0;
  while (esperando.length) esperando.shift()?.();
}
