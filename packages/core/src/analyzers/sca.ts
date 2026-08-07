// ============================================================
// Analisador de DEPENDÊNCIAS VULNERÁVEIS (SCA).
//
// Wrapper Trivy via execFile (SEM shell), mais o corretor de dependência
// embutido. `starguard scan . --only sca` responde "quais pacotes meus têm CVE"
// sem chamar IA nenhuma para escanear e sem depender de outro analisador.
// NODE-ONLY.
// ============================================================
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BIN, ENGINES } from "../config";
import { ambienteDoTrivy, tetoDeSaidaMb } from "../container";
import { parseTrivy } from "../parsers";
import { ScanUnavailable } from "../git";
// `morreuNoTeto` mora em `sast.ts` porque foi lá que o defeito foi medido, e
// duplicar a heurística de "o Node matou o filho" em dois arquivos é como as
// duas literais de `MSG_ESCANEANDO_LOCAL` deixaram de coincidir.
import { erroDeTeto, morreuNoTeto } from "./sast";
import { comSocorroLocal, pareceInstalado, probeBinary } from "../binaries";
import { enrichDependencies } from "../enrich";
import { makeDepsFixer } from "../fix/deps-fixer";
import {
  copiarManifestosPara,
  empacotarParaScan,
  faltaLockfile,
  nomesDeManifesto,
} from "../bundle";
import { comVaga } from "../scan-slot";
import {
  callRemoteScan,
  getScanTransport,
  limitesDoServidor,
  opcoesDeScanLocal,
  servidorRespondeu,
  usingRemoteScan,
  MSG_ESCANEANDO_LOCAL,
  MSG_VAGA_NA_FILA,
  RemoteScanError,
  type OpcoesDeScanLocal,
} from "../scan-transport";
import type { Analyzer } from "../contracts";
import { translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";
import { DEFAULT_LOCALE, type Locale } from "../i18n/config";
import type { DependencyVuln } from "../types";

const pExecFile = promisify(execFile);

/**
 * Teto de tempo do trivy. Ver o cabeçalho de `TETO_SAST_MS` em `sast.ts`: o
 * mesmo `300_000` escrito à mão vivia aqui, e com o mesmo desfecho mudo.
 *
 * O trivy tem um agravante próprio: na primeira execução depois de a base
 * vencer (~6 h) ele BAIXA 1,2 GB antes de olhar o primeiro manifesto, e é essa
 * execução — a de quem chega logo depois de um deploy — que estourava o teto.
 */
const TETO_SCA_MS = Number(process.env.SCA_TIMEOUT_MS) || 15 * 60_000;
const ENV_TETO_SCA = "SCA_TIMEOUT_MS";

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

  // O painel entrega um clone completo, mas o SCA de vulnerabilidades só usa
  // manifestos e lockfiles. Copiar esses poucos arquivos evita o Trivy andar
  // por todo o repositório (incluindo assets/gerados não ignorados) e não
  // bufferiza lockfiles no Node: `copyFile` trabalha fora do heap.
  const trabalho = await mkdtemp(join(tmpdir(), "sg-sca-"));
  const entrada = join(trabalho, "input");
  await mkdir(entrada, { recursive: true });
  const manifestos = await copiarManifestosPara(dir, entrada);
  if (manifestos.length === 0) {
    await rm(trabalho, { recursive: true, force: true }).catch(() => {});
    return [];
  }

  // Pelo ARQUIVO, e não pelo cano — o JSON do Trivy pode ter dezenas de MB.
  const saida = join(trabalho, "deps.json");

  const args = [
    "fs",
    "--scanners",
    "vuln",
    "--format",
    "json",
    "--quiet",
    "-o",
    saida,
    ".",
  ];

  try {
    return await comVaga(
      () => {
        // Ver o mesmo trecho em `sast.ts`: a transição é o que se anuncia.
        opts.report?.(MSG_ESCANEANDO_LOCAL);
        return pExecFile(BIN.trivy, args, {
          cwd: entrada,
          timeout: TETO_SCA_MS,
          // Com `-o` o cano só carrega aviso. Ver `sast.ts`.
          maxBuffer: 1024 * 1024,
          signal: opts.signal,
          env: ambienteDoTrivy(),
        }).then(() => lerDependencias(saida, opts));
      },
      (posicao) => opts.report?.(MSG_VAGA_NA_FILA, { n: posicao })
    );
  } catch (e: unknown) {
    const err = e as { stdout?: string; message?: string };
    if (!opts.signal?.aborted) {
      const recuperado = await lerDependencias(saida, opts).catch(() => null);
      if (recuperado) return recuperado;
    }
    // Cancelamento sobe como está: quem parou não deve ler "o SCA falhou".
    if (opts.signal?.aborted) throw e;
    // Teto estourado é dito com todas as letras — ver `morreuNoTeto` em `sast.ts`.
    if (morreuNoTeto(err)) {
      throw erroDeTeto(BIN.trivy, TETO_SCA_MS, ENV_TETO_SCA, opts.locale);
    }
    if (/ENOENT|not found/i.test(err.message || "")) {
      throw new ScanUnavailable(
        `Binário do SCA (${BIN.trivy}) não encontrado no host. Instale-o para habilitar a análise de dependências.`
      );
    }
    throw new ScanUnavailable(`Falha no SCA: ${(err.message || "").slice(0, 200)}`);
  } finally {
    await rm(trabalho, { recursive: true, force: true }).catch(() => {});
  }
}

/** Ver `lerAchados` em `sast.ts`: pergunta o tamanho antes de gastar memória. */
async function lerDependencias(
  saida: string,
  opts: OpcoesDeScanLocal
): Promise<DependencyVuln[]> {
  const teto = tetoDeSaidaMb();
  const info = await stat(saida);
  if (info.size > teto * 1024 * 1024) {
    throw new ScanUnavailable(
      translate(opts.locale ?? DEFAULT_LOCALE, "scan.outputTooLarge", {
        mb: (info.size / (1024 * 1024)).toFixed(1),
        max: teto,
      })
    );
  }
  return parseTrivy(JSON.parse(await readFile(saida, "utf8")));
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
    // Ver o mesmo trecho em `sast.ts`: sondagem inconclusiva é máquina ocupada,
    // não binário ausente. O `sca` sofria pior que o `sast` — ele roda em
    // PARALELO com o SAST, então a carga que estourava o teto dele era, quase
    // sempre, o scan do vizinho.
    if (pareceInstalado(r)) return { ok: true, detail: r.version || BIN.trivy };
    return {
      ok: false,
      reason: r.reason === "spawn_failed" ? "spawn_failed" : "binary_missing",
      detail: BIN.trivy,
    };
  },

  async run(ctx) {
    const dir = ctx.workspace!.root;
    ctx.report?.(usingRemoteScan() ? translate(ctx.locale, "scan.server") : ENGINES.sca);

    // ---- Sem lockfile, "0 vulnerabilidades" não quer dizer nada ----
    //
    // Medido na imagem de produção, com `lodash 4.17.11` e `minimist 0.0.8`
    // (as duas com CVE conhecido): só `package.json` → **0 achados**; com
    // `package-lock.json` → **9 achados**.
    //
    // A recusa do Trivy é legítima — `"^4.17.11"` é faixa, não versão, e ele
    // prefere calar a chutar. O que não podia continuar é o que isso virava na
    // nossa tela: um relatório dizendo "nenhuma dependência vulnerável" para um
    // projeto que ninguém conseguiu resolver. "Não encontrou" e "não procurou"
    // saindo iguais, numa ferramenta de segurança. Ver AUDITORIA.md#UX-15.
    //
    // Este é o MESMO recurso do `scan.truncated`: o que ficou de fora é dito em
    // voz alta, em vez de sumir dentro de um número que parece bom.
    if (faltaLockfile(await nomesDeManifesto(dir))) {
      ctx.report?.(translate(ctx.locale, "scan.noLockfile"));
    }

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
