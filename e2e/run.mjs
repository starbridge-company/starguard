#!/usr/bin/env node
// Roda todas as suítes de navegador em sequência e agrega o resultado.
// Uso: npm run test:e2e   (veja e2e/README.md para o que precisa estar de pé)
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3020";

// `run.mjs` é o runner e `comum.mjs` é biblioteca compartilhada — nenhum dos
// dois é suíte. O prefixo `_` fica reservado para rascunho local.
const NAO_SAO_SUITES = new Set(["run.mjs", "comum.mjs"]);
const suites = readdirSync(DIR)
  .filter((f) => f.endsWith(".mjs") && !NAO_SAO_SUITES.has(f) && !f.startsWith("_"))
  .sort();

// Falha cedo e com mensagem clara se a app não estiver no ar — sem isto, cada
// suíte morre num timeout de 30s e o motivo real fica escondido.
try {
  const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`health respondeu ${r.status}`);
} catch (e) {
  console.error(`\n✗ A aplicação não respondeu em ${BASE}.`);
  console.error(`  ${e instanceof Error ? e.message : e}`);
  console.error("  Veja e2e/README.md para subir o ambiente.\n");
  process.exit(1);
}

let falhas = 0;
for (const s of suites) {
  console.log(`\n${"=".repeat(60)}\n  ${s}\n${"=".repeat(60)}`);
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(DIR, s)], {
      stdio: "inherit",
      env: { ...process.env, E2E_BASE_URL: BASE },
    });
    p.on("close", resolve);
  });
  if (code !== 0) falhas++;
}

console.log(
  `\n${falhas === 0 ? "✓ todas as suítes passaram" : `✗ ${falhas} suíte(s) com falha`}`
);
process.exit(falhas ? 1 : 0);
