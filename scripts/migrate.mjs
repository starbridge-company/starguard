#!/usr/bin/env node
// ============================================================
// Aplica db/migrations usando o migrator do drizzle-orm (dependência de
// PRODUÇÃO) — ao contrário de `drizzle-kit migrate`, que é devDependency e
// não existe na imagem Docker. Mesma tabela de controle do drizzle-kit
// (schema "drizzle"), então local e container não se atropelam: migração já
// aplicada por um é reconhecida pelo outro.
// ============================================================
import "./load-env.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL ausente — nada a fazer.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 15_000,
});

try {
  await migrate(drizzle(pool), {
    migrationsFolder: join(ROOT, "db", "migrations"),
  });
  console.log("[migrate] schema em dia.");
} catch (e) {
  console.error("[migrate] falhou:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
