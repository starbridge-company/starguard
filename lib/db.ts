// ============================================================
// Cliente Postgres (Drizzle + node-postgres Pool). NODE-ONLY — nunca
// importar no middleware (edge). Singleton em globalThis para sobreviver ao
// HMR do Next e não abrir um Pool por reload.
// ============================================================
import "server-only";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

type DbState = { pool?: Pool; db?: NodePgDatabase<typeof schema> };

const g = globalThis as unknown as { __sg_db?: DbState };
g.__sg_db ||= {};

function getPool(): Pool {
  if (g.__sg_db!.pool) return g.__sg_db!.pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL ausente. Configure no .env.local para habilitar o banco."
    );
  }
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  g.__sg_db!.pool = pool;
  return pool;
}

/**
 * `host:porta/banco` do `DATABASE_URL` — SEM usuário e SEM senha.
 *
 * Existe por uma falha de deploy que custou uma tarde (07/08/2026, servidor
 * dedicado). O log tinha isto, a cada 15 segundos, e só isto:
 *
 *   Failed query: UPDATE starguard.jobs SET … ← Connection terminated due to
 *   connection timeout ← Connection terminated unexpectedly
 *
 * Vinte linhas de SQL e nenhuma palavra sobre PARA ONDE a conexão foi tentada
 * — que era exatamente a informação que faltava, porque o defeito estava no
 * endereço. "Timeout" e não "recusado" já dizia muito (pacote descartado, não
 * porta fechada: rede errada ou firewall, não Postgres no chão), mas sem o
 * destino não dá para agir sobre nenhum dos dois.
 *
 * Devolve `"(DATABASE_URL ausente)"` ou `"(DATABASE_URL ilegível)"` em vez de
 * lançar: quem chama isto está no meio de RELATAR um erro, e uma função de
 * diagnóstico que estoura apaga a mensagem que ia ser dada.
 */
export function alvoDoBanco(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "(DATABASE_URL ausente)";
  try {
    const u = new URL(url);
    // Porta explícita quando não há: "db" e "db:5432" mandam a pessoa conferir
    // coisas diferentes, e o padrão do Postgres não é óbvio para todo mundo.
    const porta = u.port || "5432";
    return `${u.hostname}:${porta}${u.pathname}`;
  } catch {
    return "(DATABASE_URL ilegível)";
  }
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (g.__sg_db!.db) return g.__sg_db!.db;
  g.__sg_db!.db = drizzle(getPool(), { schema });
  return g.__sg_db!.db;
}

// Açúcar: `db.query.users…` e chamadas diretas. Getter para lazy-init.
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? v.bind(real) : v;
  },
});

export { schema };
