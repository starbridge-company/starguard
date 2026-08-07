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
import { comVaga } from "../scan-slot";
import {
  callRemoteScan,
  getScanTransport,
  limitesDoServidor,
  opcoesDeScanLocal,
  servidorRespondeu,
  usingRemoteScan,
  RemoteScanError,
  type OpcoesDeScanLocal,
} from "../scan-transport";
import type { Analyzer } from "../contracts";
import { translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";
import type { Locale } from "../i18n/config";
import type { DependencyVuln } from "../types";

const pExecFile = promisify(execFile);

/**
 * Roda o SCA (Trivy) em modo filesystem sobre o diretório clonado.
 *
 * `opts` traz o cancelamento e o relato de fila pelo mesmo motivo do
 * `runSast`: sem o `signal`, parar de esperar não parava o trivy, e o processo
 * seguia com o banco de vulnerabilidades carregado na memória de uma caixa que
 * mal comporta um scanner. Ver `scan-slot.ts`.
 */
export async function runSca(
  dir: string,
  opts: OpcoesDeScanLocal = {}
): Promise<DependencyVuln[]> {
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
    const { stdout } = await comVaga(
      () => {
        // Ver o mesmo trecho em `sast.ts`: a transição é o que se anuncia.
        opts.report?.("scan.scanning");
        return pExecFile(BIN.trivy, args, {
          cwd: dir,
          timeout: 300_000,
          maxBuffer: 64 * 1024 * 1024,
          signal: opts.signal,
        });
      },
      (posicao) => opts.report?.("scan.slotQueued", { n: posicao })
    );
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
    // Cancelamento sobe como está: quem parou não deve ler "o SCA falhou".
    if (opts.signal?.aborted) throw e;
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
  signal?: AbortSignal,
  report?: (m: string) => void
): Promise<DependencyVuln[]> {
  const t = getScanTransport();
  if (t.kind !== "remote") return runSca(dir, { signal });

  // A sonda antes do pacote — ver o mesmo trecho em `sast.ts`. Aqui o pacote é
  // pequeno, mas o teto de envio é o mesmo e a espera inútil também.
  report?.(translate(locale, "scan.probing"));
  if (!(await servidorRespondeu(t))) {
    throw new RemoteScanError(
      `Não foi possível falar com o servidor (${t.baseUrl}).`,
      "unreachable"
    );
  }

  // O SCA manda só manifestos — alguns kilobytes — e nunca chega perto do teto.
  // Perguntar mesmo assim mantém uma regra só para os dois analisadores, em vez
  // de um caminho que respeita o servidor e outro que confia na sorte.
  const limites = await limitesDoServidor(t);
  const pacote = await empacotarParaScan(dir, "sca", {
    maxFiles: Math.min(200, limites.maxFiles),
    totalBytes: Math.min(4 * 1024 * 1024, limites.maxBytes),
  });
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
    signal,
    // "na fila (2º)" chega por aqui: o servidor roda um scanner por vez, e
    // esperar a vez é estado a mostrar, não erro a relatar.
    report: (m, valores) => report?.(translate(locale, m as MessageKey, valores)),
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
    const dir = ctx.workspace!.root;
    ctx.report?.(usingRemoteScan() ? translate(ctx.locale, "scan.server") : ENGINES.sca);

    // Dependência não passa por IA: o texto é montado por template — o Trivy
    // já diz o pacote, a versão instalada e a que corrige. Ver o princípio do
    // CLAUDE.md ("resolva pelo catálogo antes de chamar a IA").
    const local = async () =>
      enrichDependencies(await runSca(dir, opcoesDeScanLocal(ctx)), ctx.locale);

    if (!usingRemoteScan()) return local();

    // Sem `enrichDependencies` no caminho remoto: o servidor já montou os
    // textos, no idioma que este cliente pediu. Repetir aqui não é caro como no
    // SAST (não há IA envolvida), mas produziria o mesmo objeto duas vezes — e
    // no dia em que as duas versões divergirem, o bug aparece só na extensão.
    return comSocorroLocal(
      () => scaRemoto(dir, ctx.locale, ctx.signal, (m) => ctx.report?.(m)),
      local,
      BIN.trivy,
      ctx
    );
  },

  fix: makeDepsFixer(),
};
