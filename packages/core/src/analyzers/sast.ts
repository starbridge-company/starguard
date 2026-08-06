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
import { BIN, ENGINES, sastConfig, sastJobs, sastMaxMemoryMb } from "../config";
import { parseSemgrep } from "../parsers";
import { ScanUnavailable } from "../git";
import { comSocorroLocal, probeBinary } from "../binaries";
import { enrichFindings } from "../enrich";
import { makeCodeFixer } from "../fix/code-fixer";
import { empacotarParaScan } from "../bundle";
import { comVaga } from "../scan-slot";
import {
  callRemoteScanPartido,
  getScanTransport,
  limitesDoServidor,
  servidorRespondeu,
  usingRemoteScan,
  opcoesDeScanLocal,
  RemoteScanError,
  type OpcoesDeScanLocal,
} from "../scan-transport";
import type { Analyzer } from "../contracts";
import { translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";
import type { Locale } from "../i18n/config";
import type { Vulnerability } from "../types";

const pExecFile = promisify(execFile);

/** Qual executável este engine usa. `none` = desligado por configuração. */
export function sastBinary(): string | null {
  if (ENGINES.sast === "none") return null;
  return ENGINES.sast === "semgrep" ? BIN.semgrep : BIN.opengrep;
}

/**
 * Roda o SAST configurado sobre o diretório clonado e devolve as
 * vulnerabilidades.
 *
 * Duas coisas entram por `opts`, e as duas existem por causa do mesmo defeito:
 * uma requisição abandonada que continuava consumindo a máquina.
 *
 * - **`signal`** mata o processo filho. Sem ele, cancelar do lado de fora
 *   parava de ESPERAR pelo opengrep — o opengrep seguia rodando até o fim,
 *   segurando a vaga e a memória de quem viesse depois.
 * - **`report`** conta que a vez ainda não chegou, com a posição. Esperar sem
 *   saber por quanto é indistinguível de estar travado.
 */
export async function runSast(
  dir: string,
  opts: OpcoesDeScanLocal = {}
): Promise<Vulnerability[]> {
  const engine = ENGINES.sast;
  if (engine === "none") return [];

  const bin = engine === "semgrep" ? BIN.semgrep : BIN.opengrep;
  // execFile com argumentos em array — o `dir` é caminho controlado por nós.
  // `sastConfig()` = "auto" (registro remoto) ou um diretório de regras local.
  // Alvo "." + cwd=dir → paths relativos ao repo (não vaza o dir temporário).
  //
  // ---- Por que o `--timeout` deixou de ser 0 ----
  //
  // `0` não quer dizer "rápido" nem "padrão": quer dizer **sem limite algum**.
  // Uma única combinação patológica de regra e arquivo — expressão regular que
  // explode, arquivo gerado com uma linha de 200 kB — segura o processo pelo
  // tempo que precisar, e o resto da análise espera por ela. No servidor isso
  // vira uma requisição que nunca volta, que é exatamente o `timeout` que a
  // extensão relatou.
  //
  // 5 s por regra e por arquivo é o padrão do próprio Semgrep, e a troca é
  // declarada: uma regra que estoura o teto num arquivo é pulada NAQUELE
  // arquivo — a ferramenta reporta isso, e a alternativa era não terminar.
  // Configurável por env para quem preferir esperar mais.
  //
  // Medido neste repositório (272 arquivos, ruleset local completo):
  // `--timeout 0` sem `--jobs` → **62,7 s**; com estes argumentos → **54,9 s**.
  // ---- Por que `--jobs` deixou de sair de `os.cpus()` ----
  //
  // Dentro de um contêiner, `os.cpus()` conta os núcleos do HOSPEDEIRO. No
  // servidor (0,5 CPU, 512 MB) ele respondia 8, e o scan abria oito processos
  // numa caixa que comporta um: a memória estourava, a INSTÂNCIA MORRIA no meio
  // da requisição e o editor recebia a página de erro da borda. Chegava como
  // "403" no SAST e "502" no SCA que rodava em paralelo — dois analisadores
  // derrubados por um. Ver AUDITORIA.md#ARQ-15.
  //
  // Na máquina de quem desenvolve nada muda: sem cgroup com limite, o valor
  // continua sendo o número de núcleos.
  const jobs = sastJobs();
  const memoria = sastMaxMemoryMb();
  const args = [
    "--config",
    sastConfig(),
    "--json",
    "--quiet",
    "--timeout",
    String(Number(process.env.SAST_RULE_TIMEOUT ?? 5)),
    "--jobs",
    String(jobs),
    ...(memoria ? ["--max-memory", String(memoria)] : []),
    ".",
  ];

  // `--config auto` BAIXA o ruleset inteiro de semgrep.dev, a cada execução.
  //
  // É o padrão quando ninguém apontou regras locais, e é a explicação mais
  // comum para "o SAST está rodando há vinte minutos e não sai do lugar": não há
  // nada travado, há milhares de regras sendo buscadas pela rede antes de o
  // primeiro arquivo ser lido. Numa máquina atrás de proxy com CA própria isso
  // nem termina — falha no meio, e o sintoma é um erro de rede no lugar de
  // "falta configurar".
  //
  // Não dá para consertar o download; dá para parar de fazê-lo em silêncio. A
  // frase diz o que está acontecendo e qual é a saída, e o `doctor` repete o
  // aviso antes de a pessoa esperar por nada. Ver AUDITORIA.md#ARQ-17.
  if (sastConfig() === "auto") opts.report?.("scan.rulesRemote");

  try {
    // A vaga envolve só o PROCESSO NATIVO. Segurá-la durante o parse ou o
    // enriquecimento faria um scan barato esperar por trabalho que não disputa
    // CPU com ninguém. Ver `scan-slot.ts`.
    const { stdout } = await comVaga(
      () => {
        // Dito na TRANSIÇÃO, e não antes: entre pedir a vaga e recebê-la pode
        // haver minutos, e anunciar "escaneando" enquanto se espera é a mesma
        // mentira que a barra parada contava. Quem lê isto do lado do servidor
        // (`lib/scan-jobs.ts`) usa estas duas chaves para saber se o job está
        // na fila ou trabalhando.
        opts.report?.("scan.scanning");
        return pExecFile(bin, args, {
          cwd: dir,
          timeout: 300_000,
          maxBuffer: 64 * 1024 * 1024,
          // Cancelar de fora precisa MATAR o opengrep, não só parar de esperar
          // por ele. Ver o cabeçalho desta função.
          signal: opts.signal,
        });
      },
      (posicao) => opts.report?.("scan.slotQueued", posicao)
    );
    return parseSemgrep(JSON.parse(stdout));
  } catch (e: unknown) {
    // Semgrep retorna exit code != 0 quando encontra achados; o stdout ainda é JSON válido.
    const err = e as { stdout?: string; message?: string; name?: string };
    if (err.stdout) {
      try {
        return parseSemgrep(JSON.parse(err.stdout));
      } catch {
        /* cai no throw */
      }
    }
    // Cancelamento não é falha do scanner: sobe como está, para quem cancelou
    // não receber "o SAST falhou" por ter clicado em parar.
    if (opts.signal?.aborted) throw e;
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
 *
 * O que volta daqui **já vem enriquecido**: quem escaneou foi o servidor, e ele
 * chama `enrichFindings` antes de responder. Ver `run` abaixo.
 */
async function sastRemoto(
  dir: string,
  locale: Locale,
  signal?: AbortSignal,
  report?: (m: string) => void
): Promise<Vulnerability[]> {
  const t = getScanTransport();
  if (t.kind !== "remote") return runSast(dir, { signal });

  // A sonda ANTES de ler o disco e de empacotar megabytes.
  //
  // Com o servidor fora do ar, o caminho anterior era: varrer o projeto,
  // empacotar 8 MB, subir (120 s), tentar de novo (120 s), dividir em duas
  // metades e repetir tudo — sete vezes. Vinte e oito minutos para chegar a uma
  // conclusão que uma requisição de dezenas de bytes entrega em segundos.
  report?.(translate(locale, "scan.probing"));
  if (!(await servidorRespondeu(t))) {
    throw new RemoteScanError(
      `Não foi possível falar com o servidor (${t.baseUrl}).`,
      "unreachable"
    );
  }

  // Os tetos vêm do SERVIDOR, não de um palpite daqui. Ver `limitesDoServidor`.
  const limites = await limitesDoServidor(t);
  const pacote = await empacotarParaScan(dir, "sast", {
    maxFiles: limites.maxFiles,
    totalBytes: limites.maxBytes,
  });
  if (pacote.files.length === 0) return [];

  // O que NÃO coube é dito em voz alta.
  //
  // O teto do pacote é do servidor, não do projeto: um repositório grande passa
  // dele com folga, e até aqui o excesso sumia dentro de `Pacote.truncated` sem
  // ninguém ler. O resultado tinha cara de scan completo e cobria uma parte —
  // que é exatamente o UX-15 ("não encontrou" x "não procurou") no lugar mais
  // caro possível, o de uma ferramenta de segurança.
  if (pacote.truncated > 0) {
    report?.(translate(locale, "scan.truncated", { n: pacote.truncated }));
  }
  report?.(
    translate(locale, "scan.uploading", {
      n: pacote.files.length,
      mb: (pacote.bytes / (1024 * 1024)).toFixed(1),
    })
  );

  // Partido quando recusado inteiro: é o pacote GRANDE que apanha de quem está
  // no meio do caminho, e o SAST é justamente o que manda código-fonte.
  //
  // A divisão é ANUNCIADA. Ela deixa a análise mais lenta e, no limite, faz um
  // achado que dependa de dois arquivos em metades diferentes se perder —
  // acontecer em silêncio seria entregar um resultado menor com cara de
  // completo, que é o UX-15 outra vez.
  const cru = await callRemoteScanPartido(
    t,
    {
      analyzer: "sast",
      files: pacote.files,
      locale,
      signal,
      // O transporte fala por CHAVE e por número; quem sabe o idioma é o
      // analisador. `n` é a posição na fila do servidor quando há uma.
      report: (m, n) =>
        report?.(translate(locale, m as MessageKey, n === undefined ? undefined : { n })),
    },
    () => report?.(translate(locale, "scan.split"))
  );
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
    ctx.report?.(usingRemoteScan() ? translate(ctx.locale, "scan.server") : ENGINES.sast);

    // Descrições legíveis no idioma de quem pediu. O catálogo local resolve a
    // maioria sem custo; a IA entra em lote só no que sobra, e nunca lança.
    // Ver AUDITORIA.md#FEAT-03.
    const local = async () =>
      enrichFindings(await runSast(dir, opcoesDeScanLocal(ctx)), ctx.locale);

    if (!usingRemoteScan()) return local();

    // ---- Por que NÃO há `enrichFindings` no caminho remoto ----
    //
    // Porque o servidor já enriqueceu antes de responder
    // (`app/api/scan/route.ts`). Enriquecer de novo aqui era uma SEGUNDA
    // chamada de IA — paga, pelo mesmo texto, com o teto de tempo da etapa
    // `software` (280 s) e até duas retentativas. Numa análise remota isso
    // podia custar mais tempo que o scan inteiro, e não mudava uma palavra do
    // que aparecia na tela. Era a maior fatia isolada do "o SAST demora muito".
    //
    // O socorro local continua enriquecendo, porque ali quem escaneou foi esta
    // máquina e ninguém explicou nada ainda.
    return comSocorroLocal(
      () => sastRemoto(dir, ctx.locale, ctx.signal, (m) => ctx.report?.(m)),
      local,
      sastBinary(),
      ctx
    );
  },

  // A correção mora AQUI, junto de quem achou o problema.
  fix: makeCodeFixer(),
};
