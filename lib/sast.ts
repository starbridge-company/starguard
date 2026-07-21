// ============================================================
// SAST — wrapper Opengrep/Semgrep via execFile (SEM shell). NODE-ONLY.
// ============================================================
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN, ENGINES, SAST_CONFIG } from "@/lib/config";
import { parseSemgrep } from "@/lib/parsers";
import { ScanUnavailable } from "@/lib/github";
import type { Vulnerability } from "@/types";

const pExecFile = promisify(execFile);

/** Roda o SAST configurado sobre o diretório clonado e devolve as vulnerabilidades. */
export async function runSast(dir: string): Promise<Vulnerability[]> {
  const engine = ENGINES.sast;
  if (engine === "none") return [];

  const bin = engine === "semgrep" ? BIN.semgrep : BIN.opengrep;
  // execFile com argumentos em array — o `dir` é caminho controlado por nós.
  // SAST_CONFIG = "auto" (registro remoto) ou um diretório de regras local.
  // Alvo "." + cwd=dir → paths relativos ao repo (não vaza o dir temporário).
  const args = ["--config", SAST_CONFIG, "--json", "--quiet", "--timeout", "0", "."];

  try {
    const { stdout } = await pExecFile(bin, args, {
      cwd: dir,
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseSemgrep(JSON.parse(stdout));
  } catch (e: unknown) {
    // Semgrep retorna exit code != 0 quando encontra achados; o stdout ainda é JSON válido.
    const err = e as { stdout?: string; message?: string };
    if (err.stdout) {
      try {
        return parseSemgrep(JSON.parse(err.stdout));
      } catch {
        /* cai no throw */
      }
    }
    if (/ENOENT|not found/i.test(err.message || "")) {
      throw new ScanUnavailable(
        `Binário do SAST (${bin}) não encontrado no host. Instale-o ou use DEMO_MODE.`
      );
    }
    throw new ScanUnavailable(`Falha no SAST: ${(err.message || "").slice(0, 200)}`);
  }
}
