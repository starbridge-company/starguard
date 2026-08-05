// ============================================================
// Analisador de DEPENDÊNCIAS VULNERÁVEIS (SCA).
//
// Wrapper Trivy via execFile (SEM shell), mais o corretor de dependência
// embutido. `starguard scan . --only sca` responde "quais pacotes meus têm CVE"
// sem chamar IA nenhuma para escanear e sem depender de outro analisador.
// NODE-ONLY.
// ============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN, ENGINES } from "../config";
import { parseTrivy } from "../parsers";
import { ScanUnavailable } from "../git";
import { probeBinary } from "../binaries";
import { enrichDependencies } from "../enrich";
import { makeDepsFixer } from "../fix/deps-fixer";
import type { Analyzer } from "../contracts";
import type { DependencyVuln } from "../types";

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

export const scaAnalyzer: Analyzer<DependencyVuln[]> = {
  id: "sca",
  needs: { workspace: true, ai: false, binary: "trivy" },

  async probe({ hasWorkspace }) {
    if (ENGINES.sca === "none") return { ok: false, reason: "engine_off" };
    if (!hasWorkspace) return { ok: false, reason: "no_workspace" };
    const r = await probeBinary(BIN.trivy);
    return r.present
      ? { ok: true, detail: r.version }
      : { ok: false, reason: "binary_missing", detail: BIN.trivy };
  },

  async run(ctx) {
    ctx.report?.(ENGINES.sca);
    const deps = await runSca(ctx.workspace!.root);
    // Dependência não passa por IA: o texto é montado por template — o Trivy
    // já diz o pacote, a versão instalada e a que corrige. Ver o princípio do
    // CLAUDE.md ("resolva pelo catálogo antes de chamar a IA").
    return enrichDependencies(deps, ctx.locale);
  },

  fix: makeDepsFixer(),
};
