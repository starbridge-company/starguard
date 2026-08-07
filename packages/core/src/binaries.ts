// ============================================================
// Os scanners estão instalados no host? Ver AUDITORIA.md#ARQ-07.
//
// Binário ausente não derruba mais a fase (isso foi o UX-15), mas segue
// produzindo um scan que não escaneia nada. Quem opera precisa descobrir isso
// pelo /api/health, e não por um relatório vazio que parece um repositório
// limpo. NODE-ONLY.
// ============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN, ENGINES } from "./config";
import { podeCairParaLocal } from "./scan-transport";
import { ScanUnavailable } from "./git";
import { translate } from "./i18n/translate";
import type { Locale } from "./i18n/config";

const pExecFile = promisify(execFile);

export interface BinaryStatus {
  name: string;
  configured: string;
  /** `false` = engine desligado por configuração; não é problema. */
  required: boolean;
  present: boolean;
  version?: string;
  /**
   * Por que não se sabe, quando `present` é `false`.
   *
   * O `health` precisa disto para não acusar a máquina de quem opera: "não
   * está instalado" e "não respondeu enquanto um scan rodava" pedem consertos
   * opostos, e até aqui os dois saíam com a mesma frase.
   */
  reason?: BinaryProbeReason;
  detail?: string;
}

/**
 * `--version` é a checagem honesta: existir no PATH não garante que executa
 * (arquitetura errada, dependência faltando).
 *
 * O resultado é memorizado por `PROBE_TTL_MS`: o `probe` de cada analisador é
 * chamado toda vez que alguém monta um plano, e no editor isso acontece a cada
 * clique na árvore. Sem cache, seriam dois processos por clique.
 *
 * ---- Por que "não respondeu" deixou de significar "não está instalado" ----
 *
 * O teto era 5 s, e isso derrubava a análise INTEIRA numa máquina ocupada.
 * Medido nesta máquina (16 núcleos), com um scan real em andamento:
 *
 *   `opengrep --version` ocioso  →  1,8 s
 *   o mesmo, com o scan rodando  →  5,1 s, morto pelo teto
 *   `trivy --version`   ocioso   →  0,1 s
 *   o mesmo, com o scan rodando  →  5,1 s, morto pelo teto
 *
 * Quem cria essa carga é o próprio StarGuard: `runSast` abre `--jobs <núcleos>`
 * processos e o `runSca` roda em paralelo. O resultado era um ciclo que se
 * alimentava sozinho e explica o "antes funcionava, agora quebrou tudo":
 *
 *   1. a análise começa e satura a máquina;
 *   2. qualquer `probe` daquela janela estoura o teto e responde "ausente";
 *   3. a resposta ficava no cache por 60 s;
 *   4. a análise SEGUINTE montava o plano com esse cache e tirava o `sast` e o
 *      `sca` dela — com os binários instalados, parados, a um palmo de
 *      distância.
 *
 * O relatório saía sem scanner nenhum, e nada na tela dizia "não procurei":
 * dizia "o executável não foi encontrado neste computador", que é uma
 * afirmação FALSA sobre a máquina de quem lê. É o UX-15 no lugar mais caro
 * possível.
 *
 * O conserto tem três partes, e nenhuma delas é só aumentar o teto:
 *
 *   1. **Distinguir os dois desfechos.** `ENOENT` é ausência; um teto estourado
 *      é desconhecimento. Só o primeiro é uma afirmação sobre o disco.
 *   2. **Resposta boa não é apagada por desconhecimento.** Binário não se
 *      desinstala no meio de um scan: uma vez visto, ele continua visto.
 *   3. **Desconhecimento vale pouco tempo.** Guardar "não sei" por um minuto é
 *      o que contaminava a análise seguinte; segundos bastam para não abrir um
 *      processo por requisição.
 */
const PROBE_TTL_MS = 60_000;

/**
 * Quanto vale um "não deu para saber".
 *
 * Curto de propósito — ver o item 3 acima. Só existe para não abrir um processo
 * por requisição enquanto a máquina está no chão.
 */
const PROBE_TTL_INCERTO_MS = 5_000;

/**
 * Teto de uma sondagem. Generoso porque o custo de errar é assimétrico: uma
 * espera de alguns segundos atrasa um plano; um falso "ausente" cancela a
 * análise inteira e mente sobre a máquina de quem lê.
 */
const PROBE_TIMEOUT_MS = Number(process.env.BINARY_PROBE_TIMEOUT_MS) || 20_000;

const probeCache = new Map<string, { at: number; value: BinaryProbe }>();

/** Por que não se sabe. Ausente quando `present` é `true`. */
export type BinaryProbeReason =
  /** O sistema disse que não existe. É afirmação sobre o disco. */
  | "missing"
  /**
   * Não respondeu a tempo, ou não deu para criar o processo. **Não é** ausência
   * — é a máquina ocupada, e quase sempre ocupada por nós mesmos.
   */
  | "busy"
  /**
   * O executável ESTÁ no disco e o Windows recusou-se a iniciá-lo.
   *
   * Medido nesta máquina, e é o motivo de este caso existir: um `next dev` com
   * uma hora de vida passou a receber `exit 3221225794` (0xC0000142,
   * `STATUS_DLL_INIT_FAILED`) ao criar QUALQUER processo filho. Um servidor
   * recém-subido, no mesmo minuto, na mesma máquina, com o mesmo `.env.local`,
   * executava os dois binários sem hesitar.
   *
   * É condição do PROCESSO PAI, não do binário — e não volta sozinha. Merece
   * motivo próprio porque a saída é outra: não há nada a instalar, há um
   * servidor a reiniciar. Chamar isso de "não encontrado neste computador"
   * manda a pessoa conferir uma instalação que está perfeita.
   */
  | "spawn_failed";

/**
 * Códigos de saída do Windows que significam "não deu para INICIAR", e não
 * "rodou e falhou". São `NTSTATUS` devolvidos como código de saída pelo
 * carregador, antes de a primeira linha do programa rodar.
 */
const FALHA_AO_INICIAR = new Set([
  0xc0000142, // STATUS_DLL_INIT_FAILED — o carregador não inicializou o processo
  0xc0000017, // STATUS_NO_MEMORY
  0xc000012d, // STATUS_COMMITMENT_LIMIT
  0xc0000135, // STATUS_DLL_NOT_FOUND
]);

export interface BinaryProbe {
  present: boolean;
  version?: string;
  reason?: BinaryProbeReason;
  /** O erro cru, cortado. Para o `health` e o `doctor` dizerem o que houve. */
  detail?: string;
}

/**
 * Dá para contar com este binário?
 *
 * `true` também quando a sondagem foi INCONCLUSIVA por CARGA, e essa é a
 * decisão central deste módulo: entre "sei que não está" e "não consegui
 * perguntar porque a máquina estava ocupada", só o primeiro justifica tirar um
 * analisador do plano. No segundo caso a resposta certa é tentar — quem roda o
 * scan de verdade descobre em segundos, com uma mensagem que aponta o binário,
 * se ele realmente não estiver lá.
 *
 * `spawn_failed` fica de FORA de propósito: ali não é desconhecimento, é uma
 * certeza — este processo não cria filhos. Tentar mesmo assim custaria um clone
 * do repositório para falhar do mesmo jeito, e a mensagem certa ("reinicie o
 * servidor") já é conhecida antes de começar.
 */
export function pareceInstalado(r: BinaryProbe): boolean {
  return r.present || r.reason === "busy";
}

/** ENOENT é ausência; teto estourado e falta de recurso, não. */
function motivoDaFalha(e: unknown): { reason: BinaryProbeReason; detail: string } {
  const err = e as {
    code?: string | number;
    message?: string;
    killed?: boolean;
    stderr?: string;
  };
  // O `stderr` entra no detalhe, e é a parte que faltava: `Command failed: …`
  // sozinho não diz NADA sobre a causa. Quando o binário está lá e sai com
  // código != 0 — DLL faltando, arquitetura errada, licença, proxy — quem
  // explica é ele mesmo, nesta linha. Sem ela, o health acusava "ausente" um
  // executável que o disco tinha e que respondia perfeitamente noutro processo.
  const saida = (err.stderr || "").trim().split("\n")[0]?.trim();
  const primeira = (err.message || "").split("\n")[0]!.trim();
  // O código de saída junto: num binário que existe e sai != 0, ele é a única
  // pista que sobra quando o `stderr` vem vazio.
  const codigo = err.code === undefined ? "" : `exit ${String(err.code)}`;
  const detail = [primeira, codigo, saida].filter(Boolean).join(" · ").slice(0, 300);
  // `killed` é como o Node marca o processo que ELE matou ao estourar o teto.
  if (err.killed) return { reason: "busy", detail: `sem resposta em ${PROBE_TIMEOUT_MS} ms` };
  if (typeof err.code === "string" && /^(ENOENT|ENOTDIR)$/.test(err.code)) {
    return { reason: "missing", detail };
  }
  // Sem descritor, sem memória, sem processo: a máquina não deu conta de criar
  // o filho. Nada disso é uma afirmação sobre o binário existir.
  if (typeof err.code === "string" && /^(EAGAIN|EMFILE|ENFILE|ENOMEM)$/.test(err.code)) {
    return { reason: "busy", detail: err.code };
  }
  // O carregador do Windows recusou o processo. O binário existe; quem não
  // consegue criar filhos é este processo. Ver `FALHA_AO_INICIAR`.
  if (typeof err.code === "number" && FALHA_AO_INICIAR.has(err.code >>> 0)) {
    return {
      reason: "spawn_failed",
      detail: `${detail} · 0x${(err.code >>> 0).toString(16).toUpperCase()}`,
    };
  }
  // `not found` na mensagem cobre o shell de alguns runtimes; o resto é ruído
  // de execução (arquitetura errada, dependência faltando), que É ausência
  // prática: o binário está lá e não roda.
  if (/ENOENT|not found|não encontrado/i.test(detail)) return { reason: "missing", detail };
  return { reason: "missing", detail };
}

export async function probeBinary(bin: string): Promise<BinaryProbe> {
  const hit = probeCache.get(bin);
  if (hit) {
    const ttl = hit.value.reason === "busy" ? PROBE_TTL_INCERTO_MS : PROBE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.value;
  }

  let value: BinaryProbe;
  try {
    const { stdout } = await pExecFile(bin, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 64,
    });
    value = { present: true, version: stdout.trim().split("\n")[0]?.slice(0, 80) };
  } catch (e) {
    const { reason, detail } = motivoDaFalha(e);
    // Resposta boa não é apagada por desconhecimento — ver o item 2 do
    // cabeçalho. O `at` NÃO é renovado: a informação continua velha, e a
    // próxima chamada com a máquina livre volta a perguntar.
    if (reason === "busy" && hit?.value.present) return hit.value;
    value = { present: false, reason, detail };
  }
  probeCache.set(bin, { at: Date.now(), value });
  return value;
}

/** Esquece o que foi medido — o `doctor` precisa ver o estado de AGORA. */
export function clearProbeCache(): void {
  probeCache.clear();
  cache = null;
}

/**
 * Tenta no servidor; se a REDE falhar e o binário existir aqui, faz aqui.
 *
 * Nasceu de um relato de uma frase: "deu fetch failed, continua não fazendo a
 * análise". O servidor do MVP hiberna quando fica ocioso, e a primeira
 * requisição depois disso pode não voltar. Até aqui, isso derrubava o
 * analisador inteiro — com o `opengrep` instalado na máquina, parado, sem ser
 * chamado. **Não analisar nada é o pior desfecho possível para uma ferramenta
 * de segurança**, e é pior que analisar mais devagar.
 *
 * Três limites, todos deliberados:
 *
 * - **Só falha de rede.** `podeCairParaLocal` recusa `unauthorized` (é sessão,
 *   precisa ser resolvida) e `too_large` (continuaria grande aqui). Contornar
 *   esses dois esconderia o que a pessoa precisa consertar.
 * - **Só com o binário presente.** Sem ele não há nada a fazer localmente, e o
 *   erro do servidor é a informação certa a mostrar.
 * - **Sempre declarado.** A troca aparece na tela via `report`. Mudar em
 *   silêncio o lugar onde o código é processado é o tipo de decisão que este
 *   produto não toma pelas costas de ninguém — mesmo que a mudança seja para
 *   o lado mais privado, que é o caso: o local não manda nada para fora.
 */
export async function comSocorroLocal<T>(
  remoto: () => Promise<T>,
  local: () => Promise<T>,
  bin: string | null,
  ctx: { locale: Locale; report?: (message: string, pct?: number) => void }
): Promise<T> {
  try {
    return await remoto();
  } catch (e) {
    if (!podeCairParaLocal(e)) throw e;

    // Falhou lá E não dá para fazer aqui: a pessoa precisa das DUAS metades.
    //
    // Com só a primeira — "não foi possível falar com o servidor: timeout" —
    // o próximo passo fica escondido. Quem lê isso não tem como saber que
    // existe um caminho local, nem que ele está a uma configuração de
    // distância. A frase junta o que houve com o que resolve.
    // `pareceInstalado`, e não `present`: a máquina ocupada é justamente a
    // situação em que o socorro local precisa acontecer, e recusá-lo por uma
    // sondagem que estourou o teto deixaria a pessoa sem análise nenhuma com o
    // binário instalado ali.
    const r: BinaryProbe = bin ? await probeBinary(bin) : { present: false, reason: "missing" };
    if (!pareceInstalado(r)) {
      throw new ScanUnavailable(
        `${(e as Error).message}\n${translate(ctx.locale, "scan.noLocalFallback", {
          bin: bin ?? "—",
        })}`
      );
    }

    const motivo = (e as Error).message;
    ctx.report?.(translate(ctx.locale, "scan.fellBackLocal", { bin: bin! }));
    // O motivo vai junto no canal de saída de quem estiver escutando: a frase
    // curta explica O QUE mudou, e esta explica POR QUÊ.
    ctx.report?.(motivo);
    return await local();
  }
}

const TTL_MS = 60_000;
let cache: { at: number; value: BinaryStatus[] } | null = null;

/** Rota pública: sem cache, cada chamada dispararia dois processos. */
export async function checkBinaries(): Promise<BinaryStatus[]> {
  // Uma medição INCONCLUSIVA vale pouco tempo aqui pelo mesmo motivo que vale
  // pouco em `probeBinary`: guardá-la por um minuto faz o `/api/health` seguir
  // dizendo "scanner ausente" muito depois de a máquina ter esvaziado, e é
  // esse texto que quem opera lê para decidir se o servidor está são.
  if (cache) {
    const incerto = cache.value.some((b) => b.reason === "busy");
    const ttl = incerto ? PROBE_TTL_INCERTO_MS : TTL_MS;
    if (Date.now() - cache.at < ttl) return cache.value;
  }

  const alvos = [
    { name: "sast", configured: BIN[ENGINES.sast as keyof typeof BIN] ?? ENGINES.sast, required: ENGINES.sast !== "none" },
    { name: "sca", configured: BIN[ENGINES.sca as keyof typeof BIN] ?? ENGINES.sca, required: ENGINES.sca !== "none" },
  ];

  const value = await Promise.all(
    alvos.map(async (a) => {
      if (!a.required) return { ...a, present: false };
      const r = await probeBinary(a.configured);
      return { ...a, ...r };
    })
  );

  cache = { at: Date.now(), value };
  return value;
}
