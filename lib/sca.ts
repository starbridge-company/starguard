// ============================================================
// SCA — wrapper Trivy via execFile (SEM shell). NODE-ONLY.
// ============================================================
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN, ENGINES } from "@/lib/config";
import { parseTrivy } from "@/lib/parsers";
import { ScanUnavailable } from "@/lib/github";
import type { DependencyVuln } from "@/types";

const pExecFile = promisify(execFile);

/** Roda o SCA (Trivy) em modo filesystem sobre o diretório clonado. */
export async function runSca(dir: string): Promise<DependencyVuln[]> {
  const engine = ENGINES.sca;
  if (engine === "none") return [];

  const args = [
    "fs",
    "--scanners",
    "vuln",
    "--format",
    "json",
    "--quiet",
    ".",
  ];

  try {
    const { stdout } = await pExecFile(BIN.trivy, args, {
      cwd: dir,
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseTrivy(JSON.parse(stdout));
  } catch (e: unknown) {
    const err = e as { stdout?: string; message?: string };
    if (err.stdout) {
      try {
        return parseTrivy(JSON.parse(err.stdout));
      } catch {
        /* cai no throw */
      }
    }
    if (/ENOENT|not found/i.test(err.message || "")) {
      throw new ScanUnavailable(
        `Binário do SCA (${BIN.trivy}) não encontrado no host. Instale-o para habilitar a análise de dependências.`
      );
    }
    throw new ScanUnavailable(`Falha no SCA: ${(err.message || "").slice(0, 200)}`);
  }
}
