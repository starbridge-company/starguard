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
import { comSocorroLocal, probeBinary } from "../binaries";
import { enrichDependencies } from "../enrich";
import { makeDepsFixer } from "../fix/deps-fixer";
import { empacotarParaScan } from "../bundle";
import { callRemoteScan, getScanTransport, usingRemoteScan } from "../scan-transport";
import type { Analyzer } from "../contracts";
import { translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";
import type { Locale } from "../i18n/config";
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

/**
 * O mesmo scan, feito pelo servidor.
 *
 * Manda só MANIFESTOS: o Trivy resolve CVE a partir da árvore declarada de
 * dependências e não olha o seu código. São alguns kilobytes, e nenhuma linha
 * escrita por você sai da máquina — o que faz do SCA remoto a opção sem custo
 * de privacidade.
 */
async function scaRemoto(
  dir: string,
  locale: Locale,
  report?: (m: string) => void
): Promise<DependencyVuln[]> {
  const t = getScanTransport();
  if (t.kind !== "remote") return runSca(dir);

  const pacote = await empacotarParaScan(dir, "sca");
  if (pacote.files.length === 0) {
    // Sem manifesto não há o que resolver. Devolver vazio é correto e é
    // diferente de falhar: o projeto pode simplesmente não declarar
    // dependências de um jeito que o Trivy leia.
    return [];
  }
  const cru = await callRemoteScan(t, {
    analyzer: "sca",
    files: pacote.files,
    locale,
    // "na fila" chega por aqui: o servidor roda um scanner por vez, e esperar
    // a vez é estado a mostrar, não erro a relatar.
    report: (m) => report?.(translate(locale, m as MessageKey)),
  });
  return (cru ?? []) as DependencyVuln[];
}

export const scaAnalyzer: Analyzer<DependencyVuln[]> = {
  id: "sca",
  needs: { workspace: true, ai: false, binary: "trivy" },

  async probe({ hasWorkspace }) {
    if (ENGINES.sca === "none") return { ok: false, reason: "engine_off" };
    if (!hasWorkspace) return { ok: false, reason: "no_workspace" };
    // No modo remoto o binário que importa é o do SERVIDOR. Exigir um aqui
    // faria o analisador aparecer indisponível justamente para quem escolheu
    // não instalar nada — ver `scan-transport.ts`.
    if (usingRemoteScan()) return { ok: true, detail: "servidor" };
    const r = await probeBinary(BIN.trivy);
    return r.present
      ? { ok: true, detail: r.version }
      : { ok: false, reason: "binary_missing", detail: BIN.trivy };
  },

  async run(ctx) {
    ctx.report?.(usingRemoteScan() ? translate(ctx.locale, "scan.server") : ENGINES.sca);
    const deps = usingRemoteScan()
      ? await comSocorroLocal(
          () => scaRemoto(ctx.workspace!.root, ctx.locale, (m) => ctx.report?.(m)),
          () => runSca(ctx.workspace!.root),
          BIN.trivy,
          ctx
        )
      : await runSca(ctx.workspace!.root);
    // Dependência não passa por IA: o texto é montado por template — o Trivy
    // já diz o pacote, a versão instalada e a que corrige. Ver o princípio do
    // CLAUDE.md ("resolva pelo catálogo antes de chamar a IA").
    return enrichDependencies(deps, ctx.locale);
  },

  fix: makeDepsFixer(),
};
