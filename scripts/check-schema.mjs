#!/usr/bin/env node
// ============================================================
// Recusa iniciar se faltarem migrações. Ver AUDITORIA.md#ARQ-12.
//
// Roda no `prestart`, antes do servidor existir: Node puro, sem empacotador,
// sem runtime edge — que é por onde esta checagem tentou passar antes e virou
// um aviso de "Node.js API não suportada" a cada recompilação.
//
// Um banco atrás do código é o estado normal logo depois de um deploy, e o
// modo de falha era o pior possível: a aplicação subia, tudo parecia de pé, e
// o login respondia 500 para qualquer senha — com a única pista num log.
// ============================================================
import "./load-env.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.SCHEMA_CHECK === "off") {
  console.log("[schema] checagem desligada por SCHEMA_CHECK=off.");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.log("[schema] DATABASE_URL ausente — nada a verificar.");
  process.exit(0);
}

const journal = JSON.parse(
  readFileSync(join(ROOT, "db", "migrations", "meta", "_journal.json"), "utf8")
);
const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15_000,
});

try {
  // O migrator do Drizzle grava `created_at` = o `when` do jornal. Casar por
  // esse carimbo pega inclusive migração aplicada fora de ordem, que uma
  // contagem de linhas deixaria passar.
  const { rows } = await pool.query(
    "select created_at from drizzle.__drizzle_migrations"
  );
  const aplicadas = new Set(rows.map((r) => Number(r.created_at)));
  const pendentes = entries.filter((e) => !aplicadas.has(e.when));

  if (pendentes.length === 0) {
    console.log(`[schema] em dia (${entries.length} migrações).`);
    process.exit(0);
  }

  console.error(
    `\n[schema] BANCO DESATUALIZADO: ${pendentes.length} migração(ões) pendente(s).\n` +
      pendentes.map((p) => `  - ${p.tag}`).join("\n") +
      "\n\n  Rode:  npm run db:migrate\n" +
      "  (para subir mesmo assim, SCHEMA_CHECK=off — o login vai falhar)\n"
  );
  process.exit(1);
} catch (e) {
  // Banco fora do ar na hora de subir é diferente de banco atrasado: não dá
  // para afirmar nada sobre o schema, e travar o start por uma oscilação de
  // rede troca um susto por indisponibilidade.
  console.warn(`[schema] não foi possível verificar (${e.message}). Seguindo.`);
  process.exit(0);
} finally {
  await pool.end().catch(() => {});
}
