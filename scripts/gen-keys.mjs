#!/usr/bin/env node
// ============================================================
// Gera o par de chaves RS256 (JWT) e um COOKIE_SECRET e grava
// em .env.local — SEM sobrescrever valores já existentes (a menos
// que --force). Roda automaticamente antes de `dev`/`start` para
// que o app suba pronto para uso, sem chaves versionadas no repo.
// ============================================================
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_PATH = join(ROOT, ".env.local");
const FORCE = process.argv.includes("--force");

function parseEnv(content) {
  const map = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m) map[m[1]] = true;
  }
  return map;
}

function b64(pem) {
  return Buffer.from(pem, "utf8").toString("base64");
}

const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
const present = parseEnv(existing);

const additions = [];

const needKeys =
  FORCE || !present.JWT_PRIVATE_KEY || !present.JWT_PUBLIC_KEY;

if (needKeys) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  additions.push(`JWT_PRIVATE_KEY=${b64(privateKey)}`);
  additions.push(`JWT_PUBLIC_KEY=${b64(publicKey)}`);
}

if (FORCE || !present.COOKIE_SECRET) {
  additions.push(`COOKIE_SECRET=${randomBytes(32).toString("hex")}`);
}

if (additions.length === 0) {
  console.log("[gen-keys] chaves já presentes em .env.local — nada a fazer.");
  process.exit(0);
}

const header =
  existing && !existing.endsWith("\n") ? "\n" : "";
const block =
  `${header}\n# --- gerado por scripts/gen-keys.mjs (${FORCE ? "force" : "auto"}) ---\n` +
  additions.join("\n") +
  "\n";

// Com --force, remove linhas antigas dessas chaves para evitar duplicatas.
let base = existing;
if (FORCE) {
  const keys = additions.map((a) => a.split("=")[0]);
  base = existing
    .split(/\r?\n/)
    .filter((l) => !keys.some((k) => l.startsWith(`${k}=`)))
    .join("\n");
}

writeFileSync(ENV_PATH, base + block, { mode: 0o600 });
console.log(
  `[gen-keys] gravado em .env.local: ${additions
    .map((a) => a.split("=")[0])
    .join(", ")}`
);
