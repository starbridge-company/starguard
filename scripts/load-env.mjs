// ============================================================
// Carrega .env.local em process.env para scripts de CLI (drizzle-kit, seed),
// que — ao contrário do Next — não leem .env.local automaticamente.
// Parser mínimo (sem dependência), respeita valores já definidos no ambiente.
// ============================================================
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env.local");

export function loadEnv() {
  if (!existsSync(ENV_PATH)) return;
  const content = readFileSync(ENV_PATH, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    if (process.env[key] !== undefined) continue; // não sobrescreve o ambiente
    let value = line.slice(eq + 1).trim();
    // Remove aspas envolventes, se houver.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Valor não citado: remove comentário inline (só quando há espaço antes
      // do "#", como no dotenv) — preserva "#" dentro de senhas/URLs.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[key] = value;
  }
}

loadEnv();
