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

/**
 * `host:porta/banco`, sem credencial.
 *
 * Dizer EM QUAL banco a migração foi aplicada não é enfeite: quando a
 * `DATABASE_URL` do contêiner e a da máquina de quem administra apontam para
 * bancos diferentes — o interno da rede Docker contra o exposto numa porta
 * pública — os dois lados juram ter migrado, e ninguém tem como perceber que
 * são dois bancos. Esta linha é o que torna a divergência visível.
 */
function alvo() {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(DATABASE_URL ilegível)";
  }
}

/**
 * A mensagem MAIS a corrente de `cause`.
 *
 * O Drizzle embrulha a falha num erro cuja mensagem é o SQL e guarda o motivo
 * real em `cause`. `e.message` sozinho imprimia a consulta e escondia
 * `password authentication failed` / `ECONNREFUSED`.
 *
 * Duplicado do `descreverErro` de `packages/core/src/logger.ts` de propósito:
 * este script roda no contêiner, onde o `dist` do núcleo NÃO existe — o
 * `.dockerignore` descarta os `dist` dos pacotes, e o Next resolve o alias pelo
 * código-fonte no build. Importá-lo daqui quebraria a imagem.
 */
function comCausa(e) {
  const partes = [e?.message ?? String(e)];
  let atual = e?.cause;
  for (let i = 0; i < 3 && atual; i++) {
    partes.push(`${atual.code ? `[${atual.code}] ` : ""}${atual.message ?? String(atual)}`);
    atual = atual.cause;
  }
  // A URL do banco, com senha, aparece em erro de conexão do `pg`.
  return partes.join(" ← ").replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, "$1***@");
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
  console.log(`[migrate] schema em dia em ${alvo()}.`);
} catch (e) {
  console.error(`[migrate] falhou em ${alvo()}: ${comCausa(e)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
