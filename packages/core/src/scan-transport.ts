// ============================================================
// Onde os scanners rodam: nesta máquina, ou no servidor.
//
// Espelha `ai-transport.ts` de propósito — é a mesma decisão, aplicada a outra
// ferramenta, e vale a pena que os dois se pareçam.
//
//   "local"  — `opengrep` e `trivy` são executados aqui. **O código não sai da
//              máquina.** Continua sendo o padrão do terminal e o que acontece
//              se ninguém fizer login.
//
//   "remote" — os arquivos vão ao servidor do StarGuard, que tem os binários
//              instalados, e voltam os achados. Quem usa a extensão não
//              instala nada.
//
// O que muda de verdade, e precisa estar escrito onde se decide:
//
//   **No modo remoto o conteúdo dos arquivos sai da máquina.** Para `sca` isso
//   significa apenas manifestos e lockfiles — a lista de dependências, não o
//   seu código. Para `sast` significa o código-fonte, porque é ele que está
//   sendo analisado. Ver `bundle.ts`.
//
//   O servidor grava METADADO — quem pediu, qual regra, arquivo e linha. Os
//   arquivos existem num diretório temporário durante o scan e são apagados
//   depois. Isso está do outro lado, em `app/api/scan/route.ts`, e é a única
//   coisa que sustenta a frase acima.
//
// A escolha NÃO é automática. Ligar o remoto porque "há um token disponível"
// seria decidir por alguém que o código dele pode viajar.
// ============================================================
import type { ArquivoEmpacotado } from "./bundle";
import type { Locale } from "./i18n/config";
import { translate } from "./i18n/translate";
import type { MessageKey } from "./i18n/messages";

export interface RemoteScanTransport {
  kind: "remote";
  baseUrl: string;
  /** Função, e não string: o access dura 15 min e um scan pode atravessar. */
  getToken: () => Promise<string | null>;
}

export interface LocalScanTransport {
  kind: "local";
}

export type ScanTransport = LocalScanTransport | RemoteScanTransport;

// Estado de módulo pelo mesmo motivo do transporte de IA: é decisão do
// PROCESSO, não de cada chamada.
let atual: ScanTransport = { kind: "local" };

export function setScanTransport(t: ScanTransport): void {
  atual = t;
}

export function getScanTransport(): ScanTransport {
  return atual;
}

export function usingRemoteScan(): boolean {
  return atual.kind === "remote";
}

/**
 * O servidor não respondeu — dá para fazer o trabalho AQUI?
 *
 * Este é o socorro do "fetch failed": o servidor do MVP hiberna, e uma falha de
 * rede na primeira requisição do dia deixava a análise inteira sem acontecer,
 * mesmo com o binário instalado a um palmo de distância. Não analisar nada é o
 * pior desfecho possível para uma ferramenta de segurança — pior que analisar
 * mais devagar.
 *
 * **Só para falha de REDE.** `unauthorized` é problema de sessão e precisa ser
 * resolvido, não contornado; `too_large` continuaria grande localmente; e
 * `cancelled` é a pessoa mandando PARAR — rodar localmente ali seria trocar um
 * scan que ela interrompeu por outro que ela não pediu. Cair para o local
 * nesses casos esconderia o que ela precisa consertar, ou desobedeceria.
 *
 * Sobre privacidade, a direção é a segura: o remoto manda arquivos para fora, o
 * local não manda nada. Cair para o local nunca amplia o que sai da máquina —
 * o contrário seria inaceitável sem perguntar.
 *
 * E é DECLARADO: quem chama avisa na tela que rodou local e por quê. Trocar o
 * lugar onde o código é processado em silêncio é o tipo de decisão que este
 * produto não toma pelas costas de ninguém.
 */
export function podeCairParaLocal(e: unknown): boolean {
  return (
    e instanceof RemoteScanError &&
    (e.code === "unreachable" || e.code === "blocked" || e.code === "unavailable")
  );
}

export type RemoteScanErrorCode =
  | "unauthorized"
  | "too_large"
  | "unavailable"
  /**
   * **Ninguém respondeu.** DNS que não resolve, porta fechada, tempo esgotado.
   * Não houve resposta HTTP nenhuma.
   */
  | "unreachable"
  /**
   * **Alguém respondeu recusando, e não fomos nós.** Uma página de CDN, um
   * portal de rede, o proxy da empresa — resposta HTTP sem o `{error}` que toda
   * recusa nossa carrega.
   *
   * Código próprio porque a diferença decide se vale DIVIDIR o pacote, e essa
   * confusão custou vinte minutos por análise. Um intermediário que recusa o
   * pacote grande e aceita o pequeno é o caso do UX-27, e ali dividir resolve.
   * Quando ninguém respondeu, o tamanho não tem nada a ver com a falha: cada
   * metade só repaga o mesmo teto de tempo, e são SETE níveis de divisão até
   * chegar a um arquivo — 7 × 2 tentativas × 120 s = 28 minutos para descobrir
   * que o servidor está fora do ar.
   */
  | "blocked"
  /**
   * Quem parou foi a pessoa. Código próprio porque isto viajava como
   * `unreachable` — e `unreachable` AUTORIZA o socorro local. O resultado era
   * que clicar em Cancelar interrompia o scan do servidor para começar um scan
   * local, do zero, na máquina de quem acabara de pedir para parar.
   */
  | "cancelled"
  | "failed";

export class RemoteScanError extends Error {
  constructor(
    message: string,
    public code: RemoteScanErrorCode
  ) {
    super(message);
    this.name = "RemoteScanError";
  }
}

export interface RemoteScanInput {
  analyzer: "sast" | "sca";
  files: ArquivoEmpacotado[];
  locale: Locale;
  signal?: AbortSignal;
  /**
   * Para dizer na tela o que está acontecendo — inclusive "na fila, 2º".
   *
   * Recebe CHAVE de tradução, nunca frase: este módulo não conhece idioma, e
   * quem chama (o analisador) conhece. `n` é o número que a frase interpola,
   * quando ela tem um.
   */
  report?: (chave: string, n?: number) => void;
}

/**
 * O que o scan LOCAL precisa saber de quem o chamou.
 *
 * Vive aqui, e não em `contracts.ts`, porque é o par do `RemoteScanInput`: os
 * dois caminhos do mesmo scan precisam responder às mesmas duas perguntas —
 * "já cancelaram?" e "o que eu conto para a tela?".
 */
export interface OpcoesDeScanLocal {
  signal?: AbortSignal;
  report?: (chave: string, n?: number) => void;
}

/**
 * Traduz o contexto do orquestrador para o que `runSast`/`runSca` entendem.
 *
 * O `report` do contexto recebe FRASE (é o que vai para a tela) e o do scan
 * local emite CHAVE. A tradução acontece aqui, num lugar só, em vez de repetida
 * nos dois analisadores.
 */
export function opcoesDeScanLocal(ctx: {
  locale: Locale;
  signal?: AbortSignal;
  report?: (message: string, pct?: number) => void;
}): OpcoesDeScanLocal {
  return {
    signal: ctx.signal,
    report: (chave, n) =>
      ctx.report?.(
        translate(ctx.locale, chave as MessageKey, n === undefined ? undefined : { n })
      ),
  };
}

// ------------------------------------------------------------
// UM ENVIO por vez, POR CLIENTE — AUDITORIA.md#ARQ-15
// ------------------------------------------------------------
//
// O orquestrador roda os analisadores em paralelo, e isso continua certo: a
// modelagem, as regras e as skills não disputam nada. `sast` e `sca`, porém,
// sobem MEGABYTES cada um pela mesma conexão doméstica, e dois uploads
// simultâneos não terminam mais rápido que dois em fila — só chegam os dois
// atrasados, e é o primeiro byte que o servidor espera para começar a trabalhar.
//
// **O que mudou:** a fila envolve o ENVIO, não o scan inteiro.
//
// Antes ela segurava a requisição do começo ao fim, porque a requisição ERA o
// scan — e enquanto o `sast` escaneava no servidor, o `sca` ficava parado aqui
// sem ter mandado nada. Agora o envio devolve um `jobId` em segundos e o
// acompanhamento sai da fila: os dois scans entram na fila DO SERVIDOR, que é
// onde a disputa por CPU realmente existe, e o tempo total deixa de somar as
// duas esperas de rede.
let filaRemota: Promise<unknown> = Promise.resolve();
/**
 * Quantos já entraram na fila e ainda não saíram.
 *
 * Contado no momento da ENTRADA, e não quando o scan começa a rodar. A
 * diferença não é sutil: `sast` e `sca` são disparados no mesmo instante, e o
 * primeiro só começa de fato no próximo microtask — um sinalizador de "está
 * rodando" ainda estaria falso quando o segundo chegasse, e ninguém receberia o
 * aviso de fila.
 */
let aguardando = 0;

async function naFilaRemota<T>(fn: () => Promise<T>, aoEsperar?: () => void): Promise<T> {
  // Quem encontra alguém na frente é quem espera — e é avisado.
  if (aguardando > 0) aoEsperar?.();
  aguardando++;

  // `then(fn, fn)`: a fila encadeia o DESFECHO, não o resultado. Um scan que
  // falha não pode travar a vez de quem vem depois.
  const minhaVez = filaRemota.then(fn, fn);
  filaRemota = minhaVez.then(
    () => undefined,
    () => undefined
  );
  try {
    return await minhaVez;
  } finally {
    aguardando--;
  }
}

/**
 * Manda os arquivos e devolve o resultado CRU do analisador.
 *
 * Cru de propósito: quem sabe interpretar é o analisador que pediu, e o
 * servidor roda exatamente o mesmo código do núcleo. Traduzir aqui criaria um
 * segundo formato para manter em sincronia.
 */
/**
 * O que REALMENTE aconteceu na rede.
 *
 * `fetch` do Node devolve sempre a mesma frase — `"fetch failed"` — e guarda a
 * informação em `cause`. Medido: DNS inexistente e porta inválida produzem
 * mensagens idênticas e causas diferentes (`ENOTFOUND`, `bad port`).
 *
 * Repassar só a mensagem era o que fazia o painel da extensão dizer
 * "Não foi possível falar com o servidor: fetch failed" — uma frase que não
 * distingue servidor dormindo, DNS errado, proxy no caminho e certificado
 * vencido, que são quatro problemas com quatro soluções diferentes.
 */
function causaDeRede(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  return err?.cause?.code || err?.cause?.message || err?.message || "erro desconhecido";
}

// ------------------------------------------------------------
// Os tetos de tempo — e por que agora são TRÊS e não um
// ------------------------------------------------------------
//
// Havia um só, `TETO_MS = 90_000`, valendo para a requisição inteira. Ele era o
// defeito central desta extensão, e vale escrever como, porque a mesma armadilha
// espera qualquer um que trate um trabalho longo como uma requisição HTTP.
//
// Um SAST numa instância de meia CPU passa de 90 s com folga. Passado o teto, o
// `fetch` abortava — e do outro lado NADA acontecia: a rota não olhava o
// `req.signal`, o opengrep seguia rodando, a vaga seguia ocupada. O cliente
// tentava de novo, criava um SEGUNDO scan, e esse também era abandonado. Em três
// tentativas a fila do servidor estava cheia de trabalho que ninguém mais
// esperava, e a partir dali toda requisição — de qualquer projeto, de qualquer
// janela — levava 429. Era isto, e não a fila, que estava quebrado: a fila
// funcionava perfeitamente, só que ninguém nunca saía dela.
//
// Com o trabalho virando JOB, cada requisição volta a ser curta e cada teto
// mede uma coisa só:
//
//   ENVIO      — subir megabytes por uma conexão doméstica.
//   CONSULTA   — perguntar "e aí?", que é um punhado de bytes.
//   PRAZO      — quanto tempo o scan tem para acontecer LÁ.
//
// O prazo pode ser generoso justamente porque as consultas provam, de segundo em
// segundo, que o servidor continua vivo e trabalhando. Era essa prova que
// faltava — e sem ela, esperar era indistinguível de ter travado.

/** Teto de UM envio. Generoso: são megabytes, e a instância pode estar acordando. */
const TETO_ENVIO_MS = Number(process.env.SCAN_UPLOAD_TIMEOUT_MS) || 120_000;

/** Teto de UMA consulta de estado. Curto: a resposta tem dezenas de bytes. */
const TETO_CONSULTA_MS = Number(process.env.SCAN_POLL_TIMEOUT_MS) || 20_000;

/**
 * Teto da SONDA — "tem alguém aí?".
 *
 * Mais generoso que uma consulta porque a instância do MVP hiberna e a primeira
 * requisição do dia paga o tempo de acordá-la (medido acima de 45 s). Ainda
 * assim é um teto só, pago uma vez, contra os 28 minutos que o desenho anterior
 * gastava para chegar à mesma conclusão.
 */
const TETO_SONDA_MS = Number(process.env.SCAN_PROBE_TIMEOUT_MS) || 60_000;

/**
 * Quanto tempo o scan tem para terminar no servidor, do envio ao resultado.
 *
 * Quinze minutos: um repositório grande num contêiner pequeno chega perto disso,
 * e desistir antes joga fora trabalho que ia terminar. Não há risco de prender o
 * editor — quem espera é uma barra de progresso que diz a posição na fila, e o
 * botão Cancelar chega até aqui (o que ele não fazia).
 */
const PRAZO_MS = Number(process.env.SCAN_DEADLINE_MS) || 15 * 60_000;

/**
 * Intervalo entre consultas: rápido no começo, folgado depois.
 *
 * Função, e não constante de módulo, pelo mesmo motivo de `aiHttp()`: estes
 * valores são lidos dentro de um laço de espera, e um teste precisa encurtá-los
 * sem reimportar o módulo. Uma suíte que espera de verdade a cada consulta
 * mede a paciência de quem a roda, não o comportamento do código.
 */
function ritmoDeConsulta() {
  return {
    inicial: Number(process.env.SCAN_POLL_INTERVAL_MS) || 1_000,
    maximo: Number(process.env.SCAN_POLL_MAX_MS) || 5_000,
  };
}

/**
 * Consultas seguidas que podem falhar antes de desistirmos do job.
 *
 * Não é tolerância a esmo: o servidor do MVP hiberna e reinicia, e uma consulta
 * perdida no meio de um scan que está indo bem não é motivo para jogar fora dez
 * minutos de trabalho. Passado o limite, aí sim é `unreachable` — e o socorro
 * local entra.
 */
const CONSULTAS_FALHAS_MAX = 5;

/**
 * Quanto esperar entre as tentativas depois de um 429, quando o servidor não
 * diz o tempo no `Retry-After`. Cresce porque a fila do outro lado esvazia no
 * ritmo de um scan, não no de uma requisição.
 */
const ESPERAS_429 = [3_000, 8_000, 20_000] as const;

/** Teto de UMA espera: um `Retry-After` exagerado não trava o editor. */
const TETO_ESPERA_MS = 30_000;

/**
 * O scan remoto, partindo o pacote quando ele é recusado inteiro.
 *
 * O caso que motivou isto: `sca` passava e `sast` levava 403 do mesmo servidor,
 * com o mesmo token, no mesmo minuto. A diferença entre os dois é o TAMANHO —
 * o SCA manda manifestos (kilobytes) e o SAST manda o código-fonte (megabytes).
 * A recusa vinha sem corpo JSON, ou seja, não era nossa: alguém no caminho
 * (CDN, proxy de empresa, inspeção de conteúdo do antivírus) recusou o pacote
 * grande e devolveu uma página.
 *
 * Não dá para consertar o que está no meio do caminho de quem usa. Dá para
 * parar de depender de um pacote único: metade de cada vez, até passar. É o
 * mesmo recurso que a revisão por IA já usa quando a primeira tentativa não
 * cabe — reduzir o escopo e tentar de novo.
 *
 * **Só divide quando ALGUÉM RESPONDEU recusando** (`blocked`), ou quando o
 * próprio StarGuard disse que não coube (`too_large`). Uma sessão expirada
 * continuaria expirada em qualquer tamanho — dividir ali multiplicaria a mesma
 * falha.
 *
 * E, acima de tudo, **não se divide quando ninguém respondeu** (`unreachable`).
 * Essa linha custou vinte minutos por análise: com o servidor fora do ar, o
 * pacote de 800 arquivos descia sete níveis de divisão, cada um repagando os
 * 120 s do teto de envio duas vezes, antes de o socorro local sequer ser
 * cogitado. Metade de um pacote não chega mais perto de um servidor que não
 * atende do que o pacote inteiro.
 *
 * O resultado de cada analisador é uma LISTA de achados, então juntar é
 * concatenar. Um achado que dependesse de dois arquivos em metades diferentes
 * seria perdido; nas regras de padrão do Opengrep, que olham arquivo a arquivo,
 * isso não acontece. Fica declarado como limitação, não como surpresa.
 */
export async function callRemoteScanPartido(
  t: RemoteScanTransport,
  input: RemoteScanInput,
  aviso?: (partes: number) => void
): Promise<unknown> {
  try {
    return await callRemoteScan(t, input);
  } catch (e) {
    // `too_large` entra junto: é a MESMA situação dita com todas as letras
    // pelo servidor, em vez de deduzida de uma página de erro. Recusar por
    // tamanho e não tentar menor seria desistir com a solução na mão.
    const podeDividir =
      e instanceof RemoteScanError &&
      (e.code === "blocked" || e.code === "too_large") &&
      input.files.length > 1;
    if (!podeDividir || input.signal?.aborted) throw e;

    // UMA metade de cada vez, e não `Promise.all`.
    //
    // Paralelizar aqui é o instinto errado: a divisão só acontece porque o
    // outro lado JÁ não deu conta do pacote inteiro. Mandar as duas metades
    // juntas dobra a carga exatamente no momento em que ela precisa cair — e,
    // quando a causa é falta de memória no servidor, cada rodada de divisão
    // multiplica as requisições simultâneas (2, 4, 8) e mantém a instância no
    // chão. Sequencial é mais lento e é o único que converge.
    const meio = Math.ceil(input.files.length / 2);
    aviso?.(2);
    const primeira = await callRemoteScanPartido(
      t,
      { ...input, files: input.files.slice(0, meio) },
      aviso
    );
    const segunda = await callRemoteScanPartido(
      t,
      { ...input, files: input.files.slice(meio) },
      aviso
    );
    return [primeira, segunda].flatMap((p) => (Array.isArray(p) ? p : []));
  }
}

/**
 * O scan remoto inteiro: envia, acompanha, devolve o resultado.
 *
 * Só o ENVIO entra na fila do cliente. O acompanhamento fica de fora de
 * propósito — ver o cabeçalho da fila acima.
 */
export async function callRemoteScan(
  t: RemoteScanTransport,
  input: RemoteScanInput
): Promise<unknown> {
  const aceite = await naFilaRemota(
    () => enviarScan(t, input),
    () => input.report?.(MSG_NA_FILA)
  );
  // Servidor antigo (ou pacote vazio): respondeu o resultado direto, sem job.
  if (!("jobId" in aceite)) return aceite.result;
  return acompanharJob(t, input, aceite.jobId, aceite.position);
}

/** Chave da mensagem "na fila do cliente". Quem traduz é o analisador. */
export const MSG_NA_FILA = "scan.queued";

/**
 * O que o servidor devolve ao aceitar o trabalho.
 *
 * Duas formas porque há duas gerações do outro lado, e a extensão precisa
 * funcionar com as duas durante uma implantação: a nova aceita e devolve um
 * `jobId` (202), a antiga escaneia dentro da requisição e devolve o `result`
 * (200). Descobrir qual é lendo a resposta custa uma linha; exigir versões
 * casadas custaria uma janela em que ninguém consegue analisar nada.
 */
type AceiteDeScan = { jobId: string; position?: number } | { result: unknown };

/**
 * Uma requisição ao `/api/scan`, com teto de tempo próprio e cancelamento.
 *
 * Dois motivos para abortar: o teto e o clique em Cancelar. Um controlador só,
 * alimentado pelos dois.
 */
async function requisitar(
  t: RemoteScanTransport,
  token: string,
  init: { method: string; body?: string; query?: string },
  tetoMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), tetoMs);
  const repassar = () => ctrl.abort();
  signal?.addEventListener("abort", repassar);
  try {
    return await fetch(`${t.baseUrl}/api/scan${init.query ?? ""}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: init.body,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(relogio);
    signal?.removeEventListener("abort", repassar);
  }
}

async function enviarScan(
  t: RemoteScanTransport,
  input: RemoteScanInput
): Promise<AceiteDeScan> {
  const token = await t.getToken();
  if (!token) {
    throw new RemoteScanError("Sessão expirada. Entre novamente.", "unauthorized");
  }

  const payload = JSON.stringify({
    analyzer: input.analyzer,
    locale: input.locale,
    files: input.files,
    // O pedido de trabalho ASSÍNCRONO. Ausente, o servidor escaneia dentro da
    // requisição — é o que a geração anterior do cliente faz, e continua
    // valendo para ela.
    mode: "async",
  });

  const tentar = () =>
    requisitar(t, token, { method: "POST", body: payload }, TETO_ENVIO_MS, input.signal);

  let res: Response;
  try {
    res = await tentar();
  } catch {
    // Cancelamento de quem clicou NÃO é falha de rede e não se tenta de novo.
    if (input.signal?.aborted) {
      throw new RemoteScanError("Análise cancelada.", "cancelled");
    }
    try {
      res = await tentar();
    } catch (segunda) {
      throw new RemoteScanError(
        `Não foi possível falar com o servidor (${t.baseUrl}): ${causaDeRede(segunda)}`,
        "unreachable"
      );
    }
  }

  // ---- 429 é "espere", não "desista" ----
  //
  // O servidor executa UM scanner por vez (o opengrep e o trivy juntos não
  // cabem na mesma caixa), e recusa com 429 + `Retry-After` quando a fila
  // enche. Tratar isso como falha definitiva transformaria a defesa do servidor
  // num defeito do cliente: quem pediu dois analisadores veria um deles morrer
  // por estar na vez errada.
  //
  // Espera o que o servidor MANDOU esperar, com teto: um `Retry-After` grande
  // demais deixaria o editor parado sem explicação.
  for (let tentativa = 0; res.status === 429 && tentativa < ESPERAS_429.length; tentativa++) {
    const pedido = Number(res.headers.get("retry-after"));
    const espera = Math.min(
      Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : ESPERAS_429[tentativa]!,
      TETO_ESPERA_MS
    );
    if (input.signal?.aborted) throw new RemoteScanError("Análise cancelada.", "cancelled");
    await new Promise((r) => setTimeout(r, espera));
    if (input.signal?.aborted) throw new RemoteScanError("Análise cancelada.", "cancelled");
    try {
      res = await tentar();
    } catch (e) {
      throw new RemoteScanError(
        `Não foi possível falar com o servidor (${t.baseUrl}): ${causaDeRede(e)}`,
        "unreachable"
      );
    }
  }

  if (res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      jobId?: string;
      position?: number;
      result?: unknown;
    };
    // 202 com `jobId`: o trabalho foi ACEITO e acontece do outro lado.
    if (j.jobId) return { jobId: j.jobId, position: j.position };
    // 200 com `result`: servidor da geração anterior, que escaneia dentro da
    // requisição. Continua funcionando — ver `AceiteDeScan`.
    return { result: j.result ?? null };
  }

  // O corpo é lido como TEXTO e só depois interpretado como JSON.
  //
  // Toda recusa NOSSA responde `{error: "..."}`, e é esse texto que a pessoa
  // vê. Quando ele não vem, a recusa foi de outra coisa no caminho — um proxy,
  // uma CDN, um portal de rede — e aí a página devolvida é HTML, que o
  // `res.json()` engolia num `catch` vazio. O resultado era a tela dizer só
  // "Falha no scan remoto (403)": um número sem autor, que não distingue "o
  // StarGuard recusou" de "algo entre você e ele recusou". Ver UX-27.
  const bruto = await res.text().catch(() => "");
  let corpo: { message?: string; error?: string } = {};
  try {
    corpo = JSON.parse(bruto) as typeof corpo;
  } catch {
    corpo = {};
  }
  const msg = corpo.message || corpo.error;

  if (res.status === 401) {
    throw new RemoteScanError(msg || "Sessão expirada. Entre novamente.", "unauthorized");
  }
  if (res.status === 413) {
    throw new RemoteScanError(
      msg || "O projeto é grande demais para o scan remoto.",
      "too_large"
    );
  }
  if (res.status === 503) {
    // O servidor está de pé mas sem o binário. Diferente de "falhou": aqui a
    // resposta certa é avisar, não tentar de novo.
    throw new RemoteScanError(msg || "O scanner não está disponível no servidor.", "unavailable");
  }
  // Recusa que NÃO é nossa é "alguém no caminho barrou", não "fui recusado".
  //
  // Toda resposta do StarGuard é JSON com `error`. Sem isso, quem respondeu foi
  // outra coisa no caminho — e o pedido nunca chegou ao app. É `blocked`, e não
  // `unreachable`, porque a diferença decide se vale dividir o pacote: aqui
  // alguém ATENDEU e recusou, e é plausível que recuse o grande e aceite o
  // pequeno. Os dois autorizam o socorro local — com o `opengrep` instalado a um
  // palmo, deixar de analisar por causa de um 403 de CDN é o pior desfecho
  // possível. A troca continua sendo DECLARADA na tela, com o motivo junto.
  //
  // Um 403 NOSSO (com corpo JSON) continua sendo `failed` e sobe: aí é
  // permissão de verdade, e contornar esconderia o que precisa ser resolvido.
  throw new RemoteScanError(
    msg || `Falha no scan remoto (${res.status}). ${pistaDaResposta(res, bruto)}`,
    msg ? "failed" : "blocked"
  );
}

// ------------------------------------------------------------
// Os tetos são do SERVIDOR — perguntar sai mais barato que adivinhar
// ------------------------------------------------------------
//
// O cliente empacotava por conta própria (1200 arquivos, 12 MB) enquanto o
// servidor aceitava 800 e 8 MB. A conta não fecha, e não fechava para nenhum
// projeto de tamanho médio: o primeiro envio levava 413 sempre, o pacote era
// dividido em duas metades e o opengrep rodava DUAS vezes, carregando o ruleset
// inteiro em cada uma. Uma lentidão garantida por configuração — e configuração
// que ninguém podia ver, porque morava em dois arquivos diferentes.
//
// Perguntar custa uma requisição de dezenas de bytes, memorizada pelo processo.
// Falhar em perguntar não é motivo para não escanear: usa-se o padrão, que é o
// mesmo padrão da rota, e a divisão continua existindo como rede de segurança.

export interface LimitesDeScan {
  maxFiles: number;
  maxBytes: number;
}

/** O mesmo padrão de `app/api/scan/route.ts`. Se divergir, a pergunta corrige. */
const LIMITES_PADRAO: LimitesDeScan = { maxFiles: 800, maxBytes: 8 * 1024 * 1024 };

let limitesEmCache: { baseUrl: string; valor: LimitesDeScan } | undefined;

export async function limitesDoServidor(t: RemoteScanTransport): Promise<LimitesDeScan> {
  if (limitesEmCache?.baseUrl === t.baseUrl) return limitesEmCache.valor;
  let valor = LIMITES_PADRAO;
  try {
    const token = await t.getToken();
    if (token) {
      const res = await requisitar(t, token, { method: "GET" }, TETO_CONSULTA_MS);
      if (res.ok) {
        const j = (await res.json()) as Partial<LimitesDeScan>;
        if (Number.isFinite(j.maxFiles) && Number.isFinite(j.maxBytes)) {
          valor = { maxFiles: j.maxFiles!, maxBytes: j.maxBytes! };
        }
      }
    }
  } catch {
    /* servidor antigo ou fora do ar: o padrão serve, e o envio dirá o resto */
  }
  limitesEmCache = { baseUrl: t.baseUrl, valor };
  return valor;
}

/** **Só para teste** — o cache é por processo e não expira de propósito. */
export function esquecerLimites(): void {
  limitesEmCache = undefined;
}

/**
 * O servidor ATENDE? Perguntado com a requisição mais barata que existe.
 *
 * Subir 8 MB de código-fonte para descobrir que o servidor está fora do ar é
 * pagar o preço caro por uma informação barata — e pagá-lo com o teto de envio,
 * que é de dois minutos, duas vezes. A consulta de limites tem dezenas de bytes
 * e responde exatamente a mesma pergunta em segundos.
 *
 * **Atender não é autorizar.** Um `401` prova que há servidor do outro lado; o
 * que falta ali é sessão, e mandar a pessoa investigar a rede por causa de um
 * login expirado seria trocar um problema de dois cliques por uma caçada. Por
 * isso a pergunta é "houve resposta HTTP?", e não "a resposta foi boa?".
 */
export async function servidorRespondeu(t: RemoteScanTransport): Promise<boolean> {
  try {
    const token = (await t.getToken()) ?? "";
    await requisitar(t, token, { method: "GET" }, TETO_SONDA_MS);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// Acompanhar o job — AUDITORIA.md#ARQ-16
// ------------------------------------------------------------

/** O que a consulta de estado devolve. Espelha `lib/scan-jobs.ts`. */
interface EstadoDoJob {
  status: "queued" | "running" | "done" | "error" | "cancelled";
  /** Posição na fila do servidor, 1 = próximo da vez. Só quando `queued`. */
  position?: number;
  result?: unknown;
  error?: string;
  /** `true` quando o erro é falta de binário no host — vira `unavailable`. */
  unavailable?: boolean;
}

/**
 * Pergunta "e aí?" até o servidor terminar, e devolve o resultado.
 *
 * Três propriedades que a requisição única não tinha, e que são a razão inteira
 * deste desenho:
 *
 * 1. **Cancelar cancela de verdade.** O `DELETE` mata o processo no servidor.
 *    Antes, abortar o `fetch` só parava de ESPERAR: o opengrep seguia rodando,
 *    a vaga seguia ocupada, e cada tentativa acrescentava mais um órfão até a
 *    fila do servidor ficar permanentemente cheia. É o "a fila nunca é limpa".
 *
 * 2. **Nenhuma requisição é longa.** Um proxy corporativo, uma CDN ou o teto da
 *    plataforma matam conexões abertas por minutos, e matavam esta. Nenhuma
 *    consulta passa de segundos.
 *
 * 3. **A espera é informada.** "na fila (2º)" é uma frase que se pode esperar;
 *    uma barra parada, não.
 */
async function acompanharJob(
  t: RemoteScanTransport,
  input: RemoteScanInput,
  jobId: string,
  posicaoInicial?: number
): Promise<unknown> {
  const ritmo = ritmoDeConsulta();
  const ate = Date.now() + PRAZO_MS;
  let intervalo = ritmo.inicial;
  let falhasSeguidas = 0;
  // O que já foi dito à tela. Repetir "na fila (2º)" a cada segundo transforma
  // informação em ruído — e ruído é o que faz as pessoas pararem de ler.
  let ultimoAviso = "";

  const avisar = (chave: string, n?: number) => {
    const marca = `${chave}:${n ?? ""}`;
    if (marca === ultimoAviso) return;
    ultimoAviso = marca;
    input.report?.(chave, n);
  };

  if (posicaoInicial !== undefined && posicaoInicial > 0) {
    avisar("scan.queuedAt", posicaoInicial);
  }

  try {
    for (;;) {
      if (input.signal?.aborted) throw new RemoteScanError("Análise cancelada.", "cancelled");
      if (Date.now() > ate) {
        throw new RemoteScanError(
          `O scan no servidor passou de ${Math.round(PRAZO_MS / 60_000)} min sem terminar.`,
          "unreachable"
        );
      }

      await esperar(intervalo, input.signal);
      if (input.signal?.aborted) throw new RemoteScanError("Análise cancelada.", "cancelled");
      intervalo = Math.min(Math.round(intervalo * 1.4), ritmo.maximo);

      let res: Response;
      try {
        const token = await t.getToken();
        if (!token) throw new RemoteScanError("Sessão expirada. Entre novamente.", "unauthorized");
        res = await requisitar(
          t,
          token,
          { method: "GET", query: `?job=${encodeURIComponent(jobId)}` },
          TETO_CONSULTA_MS,
          input.signal
        );
      } catch (e) {
        if (e instanceof RemoteScanError) throw e;
        if (input.signal?.aborted) throw new RemoteScanError("Análise cancelada.", "cancelled");
        // Uma consulta perdida não joga fora o scan: o servidor do MVP hiberna e
        // reinicia, e o trabalho pode estar indo bem do outro lado.
        if (++falhasSeguidas >= CONSULTAS_FALHAS_MAX) {
          throw new RemoteScanError(
            `Não foi possível falar com o servidor (${t.baseUrl}): ${causaDeRede(e)}`,
            "unreachable"
          );
        }
        continue;
      }

      if (res.status === 401) {
        throw new RemoteScanError("Sessão expirada. Entre novamente.", "unauthorized");
      }
      if (res.status === 404) {
        // O job sumiu: o servidor reiniciou, ou a limpeza o recolheu por
        // abandono. Não é recusa — o trabalho simplesmente não existe mais, e
        // isso autoriza o socorro local em vez de deixar a pessoa sem análise.
        throw new RemoteScanError(
          "O scan foi perdido pelo servidor (ele pode ter reiniciado).",
          "unreachable"
        );
      }
      if (!res.ok) {
        falhasSeguidas++;
        if (falhasSeguidas >= CONSULTAS_FALHAS_MAX) {
          const bruto = await res.text().catch(() => "");
          throw new RemoteScanError(
            `Falha ao consultar o scan (${res.status}). ${pistaDaResposta(res, bruto)}`,
            "unreachable"
          );
        }
        continue;
      }

      falhasSeguidas = 0;
      const estado = (await res.json().catch(() => ({}))) as EstadoDoJob;

      if (estado.status === "done") return estado.result ?? null;
      if (estado.status === "cancelled") {
        throw new RemoteScanError("O scan foi cancelado no servidor.", "cancelled");
      }
      if (estado.status === "error") {
        // Binário ausente no host é `unavailable`: autoriza o socorro local, que
        // é o desfecho certo quando o opengrep está instalado nesta máquina.
        throw new RemoteScanError(
          estado.error || "Falha no scan remoto.",
          estado.unavailable ? "unavailable" : "failed"
        );
      }
      if (estado.status === "queued") avisar("scan.queuedAt", estado.position ?? 1);
      else avisar("scan.scanning");
    }
  } catch (e) {
    // Cancelar é o único caminho em que o job PRECISA morrer lá.
    //
    // Nos demais o servidor termina sozinho e recolhe o resultado no TTL. Aqui
    // não: quem cancelou espera que o trabalho pare, e uma vaga presa por um
    // scan que ninguém mais quer é exatamente o defeito que este desenho existe
    // para acabar.
    if (input.signal?.aborted || (e instanceof RemoteScanError && e.code === "cancelled")) {
      await cancelarJob(t, jobId);
    }
    throw e;
  }
}

/** Espera, mas acorda na hora se cancelarem. Um `setTimeout` puro não acorda. */
function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const relogio = setTimeout(fim, ms);
    function fim() {
      clearTimeout(relogio);
      signal?.removeEventListener("abort", fim);
      resolve();
    }
    signal?.addEventListener("abort", fim);
  });
}

/**
 * Manda o servidor parar e limpar.
 *
 * Nunca lança: já estamos num caminho de erro, e falhar ao cancelar não pode
 * substituir o motivo original por um erro de rede. O servidor tem a limpeza
 * por abandono como segunda linha — este `DELETE` é só a via rápida.
 */
async function cancelarJob(t: RemoteScanTransport, jobId: string): Promise<void> {
  try {
    const token = await t.getToken();
    if (!token) return;
    await requisitar(
      t,
      token,
      { method: "DELETE", query: `?job=${encodeURIComponent(jobId)}` },
      TETO_CONSULTA_MS
    );
  } catch {
    /* o abandono recolhe do outro lado; ver `lib/scan-jobs.ts` */
  }
}

/**
 * Quem recusou, quando não foi o StarGuard.
 *
 * Três dados, e cada um responde a uma pergunta: o `content-type` diz se veio
 * página em vez de resposta de API; o `server`/`cf-ray` identifica o
 * intermediário (e o `cf-ray` é o que o suporte da Cloudflare pede para achar
 * o bloqueio no painel deles); o começo do corpo costuma trazer o motivo em
 * letras garrafais.
 *
 * Cortado em 120 caracteres e sem quebras de linha: isto vai para uma
 * notificação do editor e para o canal de saída, não para um relatório.
 */
function pistaDaResposta(res: Response, corpo: string): string {
  const partes = [
    res.headers.get("content-type")?.split(";")[0],
    res.headers.get("cf-ray") ? `cf-ray ${res.headers.get("cf-ray")}` : res.headers.get("server"),
    corpo.replace(/\s+/g, " ").trim().slice(0, 120),
  ].filter(Boolean);
  return partes.length ? `[${partes.join(" · ")}]` : "";
}
