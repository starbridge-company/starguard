// ============================================================
// Analisador de VULNERABILIDADES DE CÓDIGO (SAST).
//
// Wrapper Opengrep/Semgrep via execFile (SEM shell), mais o corretor de código
// embutido. Roda sozinho: `starguard scan . --only sast` não pede descrição de
// sistema, não chama IA para escanear e não depende de nenhum outro
// analisador. NODE-ONLY.
// ============================================================
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { promisify } from "node:util";
import { BIN, ENGINES } from "../config";
// As regras saem daqui, e não de `config.ts`: a busca no disco usa `node:fs`,
// e `config.ts` precisa continuar carregável no Edge runtime.
import { regrasDoSast, regrasParaOCodigo, regrasUsaveis } from "../sast-rules";
// Do `container`, e não do `config`: as duas leem o cgroup, e `config.ts`
// precisa continuar importável do Edge runtime. Ver o cabeçalho de ambos.
import {
  sastJobs,
  sastMaxMemoryMb,
  tetoDeSaidaMb,
} from "../container";
import { parseSemgrep } from "../parsers";
import { ScanUnavailable } from "../git";
import { comSocorroLocal, pareceInstalado, probeBinary } from "../binaries";
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
  MSG_ESCANEANDO_LOCAL,
  MSG_VAGA_NA_FILA,
  opcoesDeScanLocal,
  RemoteScanError,
  type OpcoesDeScanLocal,
} from "../scan-transport";
import type { Analyzer } from "../contracts";
import { translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";
import { DEFAULT_LOCALE, type Locale } from "../i18n/config";
import type { Vulnerability } from "../types";

const pExecFile = promisify(execFile);

// ============================================================
// Quanto tempo o scanner tem — e por que 300 s era um número quebrado
// ============================================================
//
// O teto era `300_000`, escrito à mão dentro do `execFile`, e ele CONTRADIZIA o
// teto de arquivos que este mesmo produto publica. Os dois números moram em
// arquivos diferentes e ninguém os leu lado a lado — que é a mesma armadilha do
// `maxFiles` do cliente contra o da rota, e desta vez saiu mais caro.
//
// Medido, `--jobs 1`, ruleset estreitado para javascript+typescript+generic:
//
//   nesta máquina (16 núcleos, um deles), 268 arquivos  →   35 s
//   na imagem de produção (meia CPU),      27 arquivos  →   65 s
//
// Ou seja: em produção o custo é da ordem de 1,3 s por arquivo depois do custo
// fixo de carregar as regras. A rota aceita **800 arquivos por scan**
// (`SCAN_MAX_FILES`), e 800 × 1,3 s ≈ **17 minutos**. O scanner era morto aos 5.
//
// **O teto de arquivos autorizava um trabalho que o teto de tempo proibia.** E o
// desfecho não dizia nada disso: `execFile` mata o filho com SIGTERM e devolve
// `killed: true`, `stdout` VAZIO e a mensagem `Command failed: <linha de comando
// inteira>`. Cortada em 200 caracteres, o que chegava à tela era o começo de uma
// linha de comando — sem a palavra "tempo", sem quanto se esperou e sem o que
// fazer. No painel isso era "o SAST quebrou"; na extensão virava
// `status: "error"`, que é justamente o código que NÃO autoriza o socorro local
// (ver `podeCairParaLocal`), então a análise morria com o opengrep instalado a um
// palmo de distância.
//
// O padrão agora é o do PRAZO DO CLIENTE (`PRAZO_MS`, 15 min): abaixo disso o
// servidor desiste de um scan que o cliente ainda estaria esperando, e jogar
// fora dez minutos de trabalho é o desperdício mais caro que este caminho tem.
// Continua sendo um teto, e continua sendo dito quando estoura.
const TETO_SAST_MS = Number(process.env.SAST_TIMEOUT_MS) || 15 * 60_000;

/** O nome da variável vai na mensagem: quem lê precisa saber o que aumentar. */
const ENV_TETO_SAST = "SAST_TIMEOUT_MS";

/**
 * Foi o TETO que matou, ou o scanner que falhou?
 *
 * `killed` é como o Node marca o processo que ELE matou ao estourar o teto —
 * medido: `code: null`, `signal: "SIGTERM"`, `stdout` e `stderr` vazios. Sem
 * esta distinção os dois desfechos saem com a mesma frase inútil, e eles pedem
 * coisas opostas de quem lê: um pede mais tempo ou menos escopo, o outro pede
 * conserto de instalação.
 */
export function morreuNoTeto(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string | null };
  return err?.killed === true || err?.signal === "SIGTERM" || err?.signal === "SIGKILL";
}

/**
 * O erro de teto estourado, montado num lugar só.
 *
 * `sast` e `sca` produzem a MESMA frase com números diferentes, e escrevê-la
 * duas vezes é como as duas literais de `MSG_ESCANEANDO_LOCAL` deixaram de
 * coincidir sem que tipo, lint ou teste notassem.
 */
export function erroDeTeto(
  bin: string,
  tetoMs: number,
  envVar: string,
  locale: Locale = DEFAULT_LOCALE
): ScanUnavailable {
  return new ScanUnavailable(
    translate(locale, "scan.timedOut", {
      bin,
      s: Math.round(tetoMs / 1000),
      env: envVar,
    })
  );
}

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
  const regras = regrasDoSast();

  // Só as regras das linguagens que ESTÃO aqui — ver `sast-rules.ts`.
  //
  // Medido na imagem de produção com meia CPU, os mesmos 27 arquivos: ruleset
  // inteiro 348 s, só javascript+typescript 65 s. As regras de python, java,
  // go, php, ruby, csharp, c e html não casam com nada num repositório
  // TypeScript, e pagá-las é espera que não compra achado.
  //
  // Quando não dá para estreitar com segurança, `configs` volta com a raiz
  // inteira e `linguagens` volta vazio — e aí nada é dito, porque nada mudou.
  const escolha = regrasParaOCodigo(regras.config, dir);
  const config = escolha.configs.flatMap((c) => ["--config", c]);

  // ---- O resultado sai por ARQUIVO, não pelo cano ----
  //
  // Era `maxBuffer: 64 MB` num `stdout` que o Node acumula inteiro na memória
  // antes de devolver, e sobre o qual rodava um `JSON.parse` — que no V8 custa
  // outros 3 a 4× (string UTF-16 + grafo de objetos), tudo vivo ao mesmo tempo.
  // Um repositório com um arquivo gerado dentro chegava perto disso, e o
  // desfecho era o pior possível: `maxBuffer` estourado MATA o filho e devolve
  // `ENOBUFS`, que caía no `Falha no SAST: …` genérico. Um scan derrubado por
  // falta de memória do CHAMADOR, anunciado como defeito do scanner.
  //
  // Com `-o`, o opengrep escreve o JSON direto no disco e o `stdout` volta
  // **vazio** (medido: 0 bytes). O cano deixa de existir como custo, e — o que
  // vale mais — dá para PERGUNTAR O TAMANHO antes de gastar memória com ele.
  //
  // O arquivo mora FORA de `dir`: o alvo do scan é `.`, e escrever a saída lá
  // dentro faria o opengrep escanear o próprio resultado.
  const saida = join(await mkdtemp(join(tmpdir(), "sg-sast-")), "achados.json");

  const args = [
    ...config,
    "--json",
    "--quiet",
    "-o",
    saida,
    "--timeout",
    String(Number(process.env.SAST_RULE_TIMEOUT ?? 5)),
    "--jobs",
    String(jobs),
    ...(memoria ? ["--max-memory", String(memoria)] : []),
    // ---- Dois cortes de payload TENTADOS e DESCARTADOS, com a medição ----
    //
    // Ficam escritos porque parecem boa ideia e não são — e a segunda vez que
    // alguém tiver a ideia, vai ter o número em vez do palpite. Medido neste
    // repositório: 268 arquivos, 691 achados, 835 kB de JSON.
    //
    // `--max-lines-per-finding 3` (padrão 10) → 691 achados, 835 kB.
    //   **Zero.** Os achados daqui casam com uma linha só, então o contexto que
    //   ele cortaria não existe. Em troca, encolheria o `codeSnippet` que a tela
    //   e o corretor usam. Custo real, ganho nenhum.
    //
    // `--max-match-per-file 100` (padrão 10.000) → 470 achados, 623 kB.
    //   Os −27% pareciam ótimos até a conta por arquivo: `results/[id]/page.tsx`
    //   caiu de 109 achados para **0**, e `vscode/src/extension.ts` de 112 para
    //   **0**. A flag não trunca no limite — ela DESCARTA o arquivo inteiro que
    //   passar dele. Ou seja, os arquivos com mais problemas são exatamente os
    //   que sumiriam do relatório, em silêncio. É o UX-15 na forma mais cara que
    //   existe, e nenhum byte economizado paga isso.
    //
    // O teto de achados que ficou é o de `lerAchados`: corta pelos MAIS GRAVES,
    // depois do parse, e DIZ quantos ficaram de fora.
    ".",
  ];

  // Regras achadas no disco são DECLARADAS, nunca usadas em silêncio.
  //
  // Detectar e não contar seria mudar o comportamento por baixo — a mesma falta
  // que o transporte remoto evita. Quem lê a frase sabe qual ruleset produziu o
  // resultado, e é assim que "não encontrou nada" vira uma afirmação verificável
  // em vez de um palpite. Ver AUDITORIA.md#ARQ-18.
  if (regras.origem === "detectado") {
    opts.report?.("scan.rulesFound", { dir: regras.config });
  }

  // O estreitamento é DITO, sempre que acontece.
  //
  // É o que separa "5× mais rápido" de "relatório menor sem explicação": quem
  // lê sabe que rodaram as regras de javascript e typescript, e não as de
  // python — e pode conferir. Silenciar isto seria mudar a cobertura por baixo,
  // que é a falta que este projeto trata como a mais cara de todas (UX-15).
  if (escolha.linguagens.length) {
    opts.report?.("scan.rulesNarrowed", {
      langs: escolha.linguagens.join(", "),
      n: escolha.linguagens.length,
      total: escolha.disponiveis,
    });
  }

  try {
    // A vaga inclui a leitura do resultado: em 512 MB, soltar o próximo
    // scanner enquanto o Node ainda faz `JSON.parse` sobre o anterior recria o
    // mesmo pico por outra porta.
    return await comVaga(
      () => {
        // Dito na TRANSIÇÃO, e não antes: entre pedir a vaga e recebê-la pode
        // haver minutos, e anunciar "escaneando" enquanto se espera é a mesma
        // mentira que a barra parada contava. Quem lê isto do lado do servidor
        // (`lib/scan-jobs.ts`) usa estas duas chaves para saber se o job está
        // na fila ou trabalhando.
        opts.report?.(MSG_ESCANEANDO_LOCAL);
        return pExecFile(bin, args, {
          cwd: dir,
          timeout: TETO_SAST_MS,
          // 1 MB, e não 64: com `-o` o `stdout` volta vazio, e o que sobra no
          // cano é aviso do próprio opengrep. Um teto pequeno aqui deixou de
          // ser risco e passou a ser defesa.
          maxBuffer: 1024 * 1024,
          // Cancelar de fora precisa MATAR o opengrep, não só parar de esperar
          // por ele. Ver o cabeçalho desta função.
          signal: opts.signal,
        }).then(() => lerAchados(saida, opts));
      },
      (posicao) => opts.report?.(MSG_VAGA_NA_FILA, { n: posicao })
    );
  } catch (e: unknown) {
    const err = e as { stdout?: string; message?: string; name?: string };
    // Exit != 0 é o que o opengrep devolve quando ENCONTRA algo — o arquivo de
    // saída está lá e é válido. Antes a recuperação era pelo `err.stdout`, que
    // com `-o` volta vazio; ler o arquivo cobre os dois casos e não depende de
    // quanto coube num cano.
    if (!opts.signal?.aborted) {
      const recuperado = await lerAchados(saida, opts).catch(() => null);
      if (recuperado) return recuperado;
    }
    // Cancelamento não é falha do scanner: sobe como está, para quem cancelou
    // não receber "o SAST falhou" por ter clicado em parar.
    if (opts.signal?.aborted) throw e;
    // TETO estourado tem frase PRÓPRIA — ver o cabeçalho de `TETO_SAST_MS`.
    //
    // Antes caía no `Falha no SAST: ${err.message}` abaixo, e o que chegava à
    // tela era o começo de uma linha de comando cortada em 200 caracteres. Quem
    // lia não tinha como saber que o scan tinha ACABADO O TEMPO, nem quanto se
    // esperou, nem que a saída era dar CPU à caixa. "Não terminou" e "está
    // quebrado" pedem coisas opostas, e saíam com a mesma frase.
    if (morreuNoTeto(err)) {
      throw erroDeTeto(bin, TETO_SAST_MS, ENV_TETO_SAST, opts.locale);
    }
    if (/ENOENT|not found/i.test(err.message || "")) {
      throw new ScanUnavailable(
        `Binário do SAST (${bin}) não encontrado no host. Instale-o para habilitar o scan de código.`
      );
    }
    throw new ScanUnavailable(`Falha no SAST: ${(err.message || "").slice(0, 200)}`);
  } finally {
    // O JSON de achados é resultado intermediário e some com qualquer desfecho —
    // a mesma regra do temporário do job em `lib/scan-jobs.ts`. Ele contém
    // trechos do código de quem pediu.
    await rm(dirname(saida), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Lê o JSON de achados do disco — **perguntando o tamanho antes de gastar
 * memória com ele.**
 *
 * Esta é a parte que o `stdout` não deixava fazer. Um `maxBuffer` estourado é
 * uma decisão tomada quando os bytes JÁ ESTÃO na memória; um `stat` é uma
 * decisão tomada antes. A diferença aparece na conta: um JSON de N bytes vive
 * no V8 como string UTF-16 (2N) mais o grafo do `JSON.parse` — 3 a 4× o arquivo,
 * tudo ao mesmo tempo, e é isso que derruba um processo.
 *
 * Passar do teto **não é erro de scanner**, e por isso tem frase própria: o
 * scan aconteceu, o resultado é que não cabe nesta caixa.
 */
export async function lerAchados(
  saida: string,
  opts: OpcoesDeScanLocal = {}
): Promise<Vulnerability[]> {
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

  // O bruto morre aqui dentro. `parseSemgrep` produz um array MENOR (só os
  // campos que a tela usa), e manter os dois vivos era dobrar o pico à toa —
  // ainda mais porque o que vem depois, `enrichFindings`, cria um terceiro.
  const achados = parseSemgrep(JSON.parse(await readFile(saida, "utf8")));

  // ---- O teto de achados, DECLARADO ----
  //
  // `enrichFindings` devolve um array novo (é `map`), o resultado fica no job
  // pelo TTL e ainda é gravado no JSONB. Um repositório patológico multiplica
  // tudo isso por milhares. Cortar é a defesa; **cortar em silêncio seria o
  // UX-15 no lugar mais caro** — um relatório menor com cara de completo — então
  // corta-se pelos MAIS GRAVES e diz-se quantos ficaram de fora.
  const limite = Number(process.env.SCAN_MAX_FINDINGS) || 5_000;
  if (achados.length <= limite) return achados;

  const peso: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  achados.sort((a, b) => (peso[a.severity] ?? 9) - (peso[b.severity] ?? 9));
  const cortados = achados.length - limite;
  achados.length = limite;
  opts.report?.("scan.findingsCapped", { n: cortados, max: limite });
  return achados;
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
      report: (m, valores) => report?.(translate(locale, m as MessageKey, valores)),
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
    // `pareceInstalado`, e não `r.present`: uma sondagem que estourou o teto é
    // desconhecimento, não ausência — e tirar o SAST do plano por causa dela
    // era o que fazia a análise seguinte sair SEM SCANNER NENHUM enquanto a
    // anterior ainda ocupava a máquina. Ver o cabeçalho de `binaries.ts`.
    const instalado = pareceInstalado(r);
    // Binário presente e nenhuma regra é um caminho SEM saída com opengrep:
    // `--config auto` sai com exit 2 e saída vazia depois de ~27 s tentando a
    // rede, e o que chegava à tela era `Unexpected end of JSON input` — um erro
    // de parser no lugar de "faltam regras". Ver AUDITORIA.md#ARQ-18.
    if (instalado && !regrasUsaveis()) {
      return { ok: false, reason: "no_rules", detail: bin };
    }
    // O motivo carrega o NOME do binário: "instale o opengrep" é acionável,
    // "scanner indisponível" manda a pessoa adivinhar. Ver AUDITORIA.md#UX-15.
    // `||`, e não `??`: a produção devolve `version: ""` para o opengrep (ele
    // não imprime nada no stdout do contêiner), e string vazia não cai no
    // fallback de `??` — o cartão ficava sem detalhe nenhum.
    if (instalado) return { ok: true, detail: r.version || bin };
    // "não consigo INICIAR" e "não está aqui" pedem coisas diferentes de quem
    // lê: a primeira é reiniciar o servidor, a segunda é instalar. Ver
    // `BinaryProbeReason` em `binaries.ts`.
    return {
      ok: false,
      reason: r.reason === "spawn_failed" ? "spawn_failed" : "binary_missing",
      detail: bin,
    };
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
