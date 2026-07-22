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
