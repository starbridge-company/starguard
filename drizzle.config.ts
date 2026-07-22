// ============================================================
// Config do drizzle-kit (generate/migrate/push/studio).
// Lê DATABASE_URL do .env.local via scripts/load-env.mjs.
// schemaFilter mantém a introspecção restrita ao schema "starguard".
// ============================================================
import { defineConfig } from "drizzle-kit";
import "./scripts/load-env.mjs";

// `generate` só faz diff do schema (não conecta). `migrate/push/studio` exigem
// uma URL real — sem DATABASE_URL, esses comandos falham com erro de conexão.
const url = process.env.DATABASE_URL;
if (!url) {
  console.warn(
    "[drizzle] DATABASE_URL ausente — 'generate' funciona; 'migrate/push/studio' exigem defini-la no .env.local."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: url || "postgresql://localhost:5432/postgres" },
  schemaFilter: ["starguard"],
  verbose: true,
  strict: true,
});
