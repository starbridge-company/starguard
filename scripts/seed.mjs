#!/usr/bin/env node
// ============================================================
// Seed idempotente dos usuários iniciais (superadmin + admin) direto via pg.
// Roda depois da migração: `npm run db:setup` (migrate + seed) ou `db:seed`.
// Senhas com Argon2id derivado em runtime — nunca em texto puro no BD.
// ============================================================
import "./load-env.mjs";
import pg from "pg";
import argon2 from "argon2";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "[seed] DATABASE_URL ausente. Defina no .env.local antes de semear."
  );
  process.exit(1);
}

const ARGON = {
  type: argon2.argon2id,
  memoryCost: Number(process.env.ARGON_MEMORY_KIB || 19456),
  timeCost: Number(process.env.ARGON_ITERATIONS || 3),
  parallelism: Number(process.env.ARGON_PARALLELISM || 1),
};

const users = [
  {
    email: (process.env.SEED_SUPERADMIN_EMAIL || "admin@starguard.local").toLowerCase(),
    password: process.env.SEED_SUPERADMIN_PASSWORD || "StarGuard!2026",
    name: "Super Admin",
    role: "superadmin",
  },
  {
    email: (process.env.SEED_ADMIN_EMAIL || "membro@starguard.local").toLowerCase(),
    password: process.env.SEED_ADMIN_PASSWORD || "StarGuard!2026",
    name: "Membro",
    role: "admin",
  },
];

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  for (const u of users) {
    const hash = await argon2.hash(u.password, ARGON);
    const res = await client.query(
      `insert into starguard.users (email, name, password_hash, role)
       values ($1, $2, $3, $4::starguard.role)
       on conflict (email) do nothing
       returning id`,
      [u.email, u.name, hash, u.role]
    );
    if (res.rowCount > 0) {
      console.log(`[seed] criado ${u.role}: ${u.email}`);
    } else {
      console.log(`[seed] já existe (mantido): ${u.email}`);
    }
  }
  console.log("[seed] concluído.");
} catch (e) {
  console.error("[seed] falhou:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
