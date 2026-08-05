// ============================================================
// Cota de IA por conta.
//
// Com pre-commit, PR e commit na main disparando análise, um repositório ativo
// gera dezenas de execuções por dia. Sem um corte, a fatura do mês é
// imprevisível — e quem paga é a Starbridge. A cota existe para transformar
// "quanto vai custar?" numa pergunta com resposta.
//
// Duas decisões que valem estar escritas:
//
// 1. **O corte é ANTES da chamada, não depois.** Verificar o gasto só ao
//    registrar deixaria a última chamada estourar o teto — e uma chamada de
//    correção com arquivo inteiro não é barata.
// 2. **O custo é gravado em milionésimos de dólar, como inteiro.** Somar
//    `0.000042` mil vezes em ponto flutuante acumula erro; e um relatório de
//    cobrança que não fecha é pior que não ter relatório.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage } from "@/db/schema";

/**
 * Teto mensal por conta, em dólares.
 *
 * O padrão de US$ 50 é uma escolha de operação, não um número mágico: com o
 * preço atual do Sonnet, cobre com folga o uso de uma pessoa fazendo análise
 * de diff em vários repositórios por dia, e corta bem antes de uma fatura
 * surpreendente. Quem precisar de mais sobe por env, ciente do que está
 * autorizando.
 */
export const MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD || 50);

/** Preço por milhão de tokens, em dólares. */
interface Preco {
  entrada: number;
  saida: number;
}

/**
 * Tabela de preços por modelo.
 *
 * Fica em código, versionada, e não em banco: mudança de preço é evento raro
 * que precisa de revisão, não configuração que alguém ajusta sem rastro. O
 * `fallback` existe porque um modelo novo não pode fazer a cota parar de
 * contar — cobrar a mais é recuperável, deixar de cobrar não.
 */
const PRECOS: Record<string, Preco> = {
  "claude-opus-5": { entrada: 5, saida: 25 },
  "claude-sonnet-5": { entrada: 3, saida: 15 },
  "claude-haiku-4-5": { entrada: 1, saida: 5 },
  "gpt-5": { entrada: 3, saida: 12 },
  "gemini-2.5-pro": { entrada: 2.5, saida: 10 },
};

const FALLBACK: Preco = { entrada: 5, saida: 25 };

function precoDe(model: string): Preco {
  // Casamento por prefixo: os provedores versionam o id do modelo
  // (`claude-sonnet-5-20260101`) e a tabela não deve precisar de uma entrada
  // por data.
  const achado = Object.entries(PRECOS).find(([id]) => model.startsWith(id));
  return achado?.[1] ?? FALLBACK;
}

/** Custo em MILIONÉSIMOS de dólar. Inteiro, para somar sem erro acumulado. */
export function custoMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = precoDe(model);
  const usd = (inputTokens / 1e6) * p.entrada + (outputTokens / 1e6) * p.saida;
  return Math.round(usd * 1e6);
}

/** "2026-08" — a janela da cota. UTC para não depender do fuso do servidor. */
export function mesAtual(agora = new Date()): string {
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Primeiro instante do mês seguinte — quando a cota renova. */
export function proximaRenovacao(agora = new Date()): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1));
}

export interface UsoDoMes {
  month: string;
  costUsd: number;
  budgetUsd: number;
  /** Quanto sobra, em dólares. Nunca negativo. */
  remainingUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export async function usoDoMes(userId: string, month = mesAtual()): Promise<UsoDoMes> {
  const [linha] = await db
    .select({
      custo: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)::bigint`,
      chamadas: sql<number>`count(*)::int`,
      entrada: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::bigint`,
      saida: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::bigint`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)));

  const costUsd = Number(linha?.custo ?? 0) / 1e6;
  return {
    month,
    costUsd,
    budgetUsd: MONTHLY_BUDGET_USD,
    remainingUsd: Math.max(0, MONTHLY_BUDGET_USD - costUsd),
    calls: Number(linha?.chamadas ?? 0),
    inputTokens: Number(linha?.entrada ?? 0),
    outputTokens: Number(linha?.saida ?? 0),
  };
}

export type ChecagemDeCota =
  | { ok: true; uso: UsoDoMes }
  | { ok: false; uso: UsoDoMes; resetsAt: string };

/**
 * A conta ainda tem orçamento?
 *
 * Chamado ANTES de falar com o modelo. Falha do banco NÃO bloqueia a chamada:
 * um limitador fora do ar não pode derrubar o produto — é a mesma decisão já
 * tomada no rate limit (`lib/ratelimit.ts`). O risco de deixar passar algumas
 * chamadas é menor que o de parar todas.
 */
export async function checarCota(userId: string): Promise<ChecagemDeCota> {
  const uso = await usoDoMes(userId).catch(() => null);
  if (!uso) {
    return {
      ok: true,
      uso: {
        month: mesAtual(),
        costUsd: 0,
        budgetUsd: MONTHLY_BUDGET_USD,
        remainingUsd: MONTHLY_BUDGET_USD,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
  }
  if (uso.costUsd >= MONTHLY_BUDGET_USD) {
    return { ok: false, uso, resetsAt: proximaRenovacao().toISOString() };
  }
  return { ok: true, uso };
}

/**
 * Registra o consumo. Nunca lança.
 *
 * Perder o registro de uma chamada já feita é ruim (a conta fica subestimada),
 * mas derrubar a resposta que a pessoa está esperando por causa do registro é
 * pior. O erro vai para o log estruturado, onde dá para reconciliar.
 */
export async function registrarUso(input: {
  userId: string;
  purpose?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  repo?: string;
}): Promise<void> {
  try {
    await db.insert(aiUsage).values({
      userId: input.userId,
      month: mesAtual(),
      purpose: input.purpose ?? null,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costMicroUsd: custoMicroUsd(input.model, input.inputTokens, input.outputTokens),
      repo: input.repo ?? null,
    });
  } catch (e) {
    const { log } = await import("@starguard/core/logger");
    log.error("ai.usage.persist.failed", { userId: input.userId, error: e });
  }
}
