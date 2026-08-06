// ============================================================
// Analisador de VULNERABILIDADES DE CÓDIGO (SAST).
//
// Wrapper Opengrep/Semgrep via execFile (SEM shell), mais o corretor de código
// embutido. Roda sozinho: `starguard scan . --only sast` não pede descrição de
// sistema, não chama IA para escanear e não depende de nenhum outro
// analisador. NODE-ONLY.
// ============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN, ENGINES, sastConfig } from "../config";
import { parseSemgrep } from "../parsers";
import { ScanUnavailable } from "../git";
import { comSocorroLocal, probeBinary } from "../binaries";
import { enrichFindings } from "../enrich";
import { makeCodeFixer } from "../fix/code-fixer";
import { empacotarParaScan } from "../bundle";
import { callRemoteScan, getScanTransport, usingRemoteScan } from "../scan-transport";
import type { Analyzer } from "../contracts";
import type { Locale } from "../i18n/config";
import type { Vulnerability } from "../types";

const pExecFile = promisify(execFile);

/** Qual executável este engine usa. `none` = desligado por configuração. */
export function sastBinary(): string | null {
  if (ENGINES.sast === "none") return null;
  return ENGINES.sast === "semgrep" ? BIN.semgrep : BIN.opengrep;
}

/** Roda o SAST configurado sobre o diretório clonado e devolve as vulnerabilidades. */
export async function runSast(dir: string): Promise<Vulnerability[]> {
  const engine = ENGINES.sast;
  if (engine === "none") return [];

  const bin = engine === "semgrep" ? BIN.semgrep : BIN.opengrep;
  // execFile com argumentos em array — o `dir` é caminho controlado por nós.
  // `sastConfig()` = "auto" (registro remoto) ou um diretório de regras local.
  // Alvo "." + cwd=dir → paths relativos ao repo (não vaza o dir temporário).
  const args = ["--config", sastConfig(), "--json", "--quiet", "--timeout", "0", "."];

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
        `Binário do SAST (${bin}) não encontrado no host. Instale-o para habilitar o scan de código.`
      );
    }
    throw new ScanUnavailable(`Falha no SAST: ${(err.message || "").slice(0, 200)}`);
  }
}

/**
 * O mesmo scan, feito pelo servidor.
 *
 * Aqui o que viaja é CÓDIGO-FONTE — não tem como ser diferente, é ele que
 * está sendo analisado. É a diferença em relação ao SCA, que manda só
 * manifestos, e é por isso que a interface separa os dois na hora de pedir
 * consentimento.
 */
async function sastRemoto(dir: string, locale: Locale): Promise<Vulnerability[]> {
  const t = getScanTransport();
  if (t.kind !== "remote") return runSast(dir);

  const pacote = await empacotarParaScan(dir, "sast");
  if (pacote.files.length === 0) return [];
  const cru = await callRemoteScan(t, {
    analyzer: "sast",
    files: pacote.files,
    locale,
  });
  return (cru ?? []) as Vulnerability[];
}

export const sastAnalyzer: Analyzer<Vulnerability[]> = {
  id: "sast",
  needs: { workspace: true, ai: false },
  // Nenhum `uses`: o SAST não precisa de ninguém. Ele é a base que os outros
  // consultam, não o contrário.

  async probe({ hasWorkspace }) {
    if (ENGINES.sast === "none") return { ok: false, reason: "engine_off" };
    if (!hasWorkspace) return { ok: false, reason: "no_workspace" };
    // No modo remoto quem tem o binário é o SERVIDOR. Ver `scan-transport.ts`.
    if (usingRemoteScan()) return { ok: true, detail: "servidor" };
    const bin = sastBinary()!;
    const r = await probeBinary(bin);
    // O motivo carrega o NOME do binário: "instale o opengrep" é acionável,
    // "scanner indisponível" manda a pessoa adivinhar. Ver AUDITORIA.md#UX-15.
    return r.present
      ? { ok: true, detail: r.version }
      : { ok: false, reason: "binary_missing", detail: bin };
  },

  async run(ctx) {
    const dir = ctx.workspace!.root;
    ctx.report?.(usingRemoteScan() ? "servidor" : ENGINES.sast);
    const achados = usingRemoteScan()
      ? await comSocorroLocal(
          () => sastRemoto(dir, ctx.locale),
          () => runSast(dir),
          sastBinary(),
          ctx
        )
      : await runSast(dir);
    // Descrições legíveis no idioma de quem pediu. O catálogo local resolve a
    // maioria sem custo; a IA entra em lote só no que sobra, e nunca lança.
    // Ver AUDITORIA.md#FEAT-03.
    return enrichFindings(achados, ctx.locale);
  },

  // A correção mora AQUI, junto de quem achou o problema.
  fix: makeCodeFixer(),
};
