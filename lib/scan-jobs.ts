// ============================================================
// O scan do servidor como TRABALHO, não como requisição — AUDITORIA.md#ARQ-16.
//
// Por que isto existe, em uma frase: **um scan dura minutos e uma requisição
// HTTP não.**
//
// O desenho anterior escaneava dentro do `POST /api/scan` e devolvia os
// achados na mesma resposta. Enquanto o SAST cabia no tempo, funcionava. Quando
// deixou de caber — instância de meia CPU, ruleset inteiro, repositório de
// verdade — o encadeamento foi este, e vale escrito porque é a armadilha
// clássica de tratar trabalho longo como requisição:
//
//   1. o cliente desistia no teto dele (90 s) e abortava o `fetch`;
//   2. **aqui não acontecia nada**: a rota não olhava o `req.signal`, então o
//      opengrep continuava rodando, com a vaga ocupada;
//   3. o cliente tentava de novo e criava um SEGUNDO scan, tão órfão quanto;
//   4. em três tentativas a fila estava cheia de trabalho que ninguém esperava,
//      e a partir dali toda requisição — de qualquer pessoa, de qualquer
//      projeto — levava 429.
//
// O relato de quem usava era "a fila nunca é limpa". A fila estava certa: o
// que faltava era alguém SAIR dela. Ninguém saía porque ninguém era avisado de
// que o trabalho tinha deixado de interessar.
//
// O que muda aqui:
//
//   - o `POST` **aceita** o trabalho e responde em segundos, com um `jobId`;
//   - o `GET` responde o estado — e é o polling que prova que ainda há alguém
//     do outro lado interessado no resultado;
//   - o `DELETE` **mata o processo** e apaga o temporário;
//   - o que ninguém consulta há um tempo é recolhido, com processo e disco
//     junto. Esta é a rede de segurança: cobre a janela em que o editor foi
//     fechado, a máquina hibernou ou o Wi-Fi caiu — casos em que não existe
//     ninguém para mandar o `DELETE`.
//
// Estado de MÓDULO, e não banco: é a mesma escolha de `lib/jobs.ts`, pelo mesmo
// motivo — o diretório temporário do scan também é local ao processo, então um
// job que sobrevivesse ao reinício apontaria para arquivos que não existem
// mais. Com mais de uma instância, cada uma cuida dos seus; o cliente trata
// "job desconhecido" como falha de rede e cai para o binário local.
// ============================================================
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { audit } from "@/lib/auth";
// Estático, e não dinâmico como `runSast`/`runSca`: `scan-transport.ts` é TS
// puro (não toca em `node:*`), então importá-lo não arrasta o núcleo NODE-ONLY
// para o grafo de quem carrega este módulo.
import {
  MSG_ESCANEANDO_LOCAL,
  MSG_VAGA_NA_FILA,
  SILENCIO_TOLERADO_MS,
} from "@starguard/core/scan-transport";
import type { Locale } from "@/lib/i18n/config";

export type EstadoDoScan = "queued" | "running" | "done" | "error" | "cancelled";

export interface ScanJob {
  id: string;
  /** Dono. Ninguém consulta nem cancela o job de outra pessoa. */
  userId: string;
  analyzer: "sast" | "sca";
  locale: Locale;
  status: EstadoDoScan;
  /** Diretório temporário com os arquivos recebidos. Apagado ao terminar. */
  dir: string | null;
  result?: unknown;
  error?: string;
  /** Binário ausente no host: o cliente distingue disso "o scan falhou". */
  unavailable?: boolean;
  /**
   * Posição na fila de VAGAS do scanner, quando ele está esperando uma.
   *
   * É a posição mais honesta que existe: vem de quem distribui o recurso
   * (`scan-slot.ts` do núcleo), e conta também os scans disparados pelo painel
   * web, que não passam por rota nenhuma e portanto não aparecem no mapa de
   * jobs.
   */
  vaga?: number;
  /** Mata o processo nativo. É o que faz o `DELETE` ser mais que cosmético. */
  abortar: AbortController;
  criadoEm: number;
  /** Última consulta. É por aqui que se descobre que ninguém quer mais isto. */
  visitadoEm: number;
  terminadoEm?: number;
  /** Quantos arquivos e bytes entraram — para a auditoria, não para o cliente. */
  arquivos: number;
  bytes: number;
}

/**
 * Sem consulta por este tempo, o job é considerado ABANDONADO.
 *
 * **Derivado da tolerância do CLIENTE, e não escolhido aqui.** Eram 60 s
 * escritos à mão, contra um cliente que tolera até `SILENCIO_TOLERADO_MS`
 * (5 consultas × 20 s = 100 s) de silêncio antes de desistir do job. Os dois
 * números moram em pacotes diferentes e ninguém os leu lado a lado — o resultado
 * é que a tolerância do cliente nunca chegou a valer: com 60 s o servidor sempre
 * recolhia primeiro, e o que a pessoa via era
 * "O scan foi perdido pelo servidor (ele pode ter reiniciado)" depois de dez
 * minutos de scan que estava indo bem.
 *
 * A margem de 2× em cima do que o cliente tolera é deliberada: recolher cedo
 * demais joga fora trabalho caro (um SAST de repositório grande custa minutos de
 * CPU), e recolher tarde demais custa uma vaga ociosa por alguns minutos. O
 * segundo erro é muito mais barato que o primeiro.
 */
const ABANDONO_MS =
  Number(process.env.SCAN_JOB_IDLE_MS) || Math.max(60_000, SILENCIO_TOLERADO_MS * 2);

/**
 * Quanto tempo um resultado pronto fica disponível para ser buscado.
 *
 * Ele já está na memória; o que se guarda é a resposta, não os arquivos (esses
 * são apagados assim que o scanner termina). Cinco minutos cobrem uma retomada
 * de rede sem transformar a instância em cache.
 */
const TTL_MS = Number(process.env.SCAN_JOB_TTL_MS) || 2 * 60_000;

/**
 * Quantos jobs uma pessoa pode ter ao mesmo tempo.
 *
 * Dois, porque é exatamente o que uma análise pede: `sast` e `sca`. Um terceiro
 * pedido do mesmo dono derruba o mais velho — que, quando isso acontece, é
 * quase sempre um resto de uma janela que já foi fechada.
 */
const POR_PESSOA = Number(process.env.SCAN_JOBS_PER_USER) || 2;

// `globalThis` e não `const` de módulo: o hot reload do Next reavalia o módulo
// e criaria um segundo mapa, deixando os jobs do primeiro rodando sem dono.
const g = globalThis as unknown as { __sg_scan_jobs?: Map<string, ScanJob> };
g.__sg_scan_jobs ||= new Map();
const jobs = g.__sg_scan_jobs;

/** Quantos jobs existem agora — o `/api/health` publica isto. */
export function totalDeJobs(): number {
  return jobs.size;
}

/** Quantos ainda não terminaram. É a fila de verdade. */
export function jobsAtivos(): number {
  let n = 0;
  for (const j of jobs.values()) if (j.status === "queued" || j.status === "running") n++;
  return n;
}

/**
 * Posição na fila, 1 = próximo da vez.
 *
 * Duas fontes, e a primeira é melhor: quando o job já está disputando uma VAGA
 * de scanner, a posição vem de quem distribui o recurso — e essa conta inclui os
 * scans do painel web, que não passam por rota nenhuma e não aparecem no mapa
 * de jobs. Antes disso, resta a ordem de chegada aqui.
 *
 * Nenhuma das duas é exata, e não precisa ser: a pergunta que ela responde é
 * "falta muito?". Um número aproximado e honesto vale mais que uma barra sem
 * número nenhum — que foi o que a extensão mostrou durante todo esse tempo.
 */
export function posicaoNaFila(id: string): number {
  const job = jobs.get(id);
  if (job?.vaga) return job.vaga;
  const espera = [...jobs.values()]
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.criadoEm - b.criadoEm);
  const i = espera.findIndex((j) => j.id === id);
  return i < 0 ? 0 : i + 1;
}

export function acharJob(id: string, userId: string): ScanJob | undefined {
  const j = jobs.get(id);
  // Dono errado responde igual a inexistente: confirmar a existência de um job
  // alheio já é informação que ninguém precisa dar.
  return j && j.userId === userId ? j : undefined;
}

/**
 * Cria o diretório temporário e grava os arquivos recebidos.
 *
 * Continua sendo o ponto onde código de outra pessoa entra na nossa máquina, e
 * a validação de caminho continua em `app/api/scan/route.ts`, junto do teste
 * que a cobre. Aqui só se escreve o que já foi aprovado.
 */
export async function prepararDiretorio(
  arquivos: { rel: string; content: string }[]
): Promise<{ dir: string; escritos: number }> {
  const dir = await mkdtemp(join(tmpdir(), "sg-scan-"));
  let escritos = 0;
  for (const f of arquivos) {
    const destino = join(dir, f.rel);
    // Cinto e suspensório: mesmo depois da normalização, confere que o absoluto
    // resultante continua dentro da raiz.
    if (!destino.startsWith(dir + sep)) continue;
    await mkdir(join(destino, ".."), { recursive: true });
    await writeFile(destino, f.content, "utf8");
    escritos++;
    // ---- O que já está no disco não precisa continuar na memória ----
    //
    // O corpo de um envio de SAST chega aqui como 800 strings somando até 8 MB —
    // que no V8 são ~16 MB em UTF-16, e que até agora ficavam TODAS vivas até o
    // laço terminar, ao lado da cópia que acabara de ser escrita em disco. O
    // pico era o pacote inteiro duas vezes, com dois envios podendo coincidir.
    //
    // Soltar a referência arquivo a arquivo transforma esse pico em "um arquivo
    // de cada vez": o coletor recupera cada string assim que ela aterrissa. Só
    // funciona porque a rota larga o `corpo.files` antes de chamar aqui — se
    // sobrasse uma segunda referência, a string continuaria viva e isto seria
    // teatro. Ver `app/api/scan/route.ts`.
    f.content = "";
  }
  return { dir, escritos };
}

export interface NovoJob {
  userId: string;
  analyzer: "sast" | "sca";
  locale: Locale;
  dir: string;
  arquivos: number;
  bytes: number;
}

/** Registra o job e dispara a execução. Não espera por ela — esse é o ponto. */
export function criarJob(novo: NovoJob): ScanJob {
  recolherAbandonados();
  limitarPorPessoa(novo.userId);

  const job: ScanJob = {
    id: randomUUID(),
    userId: novo.userId,
    analyzer: novo.analyzer,
    locale: novo.locale,
    status: "queued",
    dir: novo.dir,
    abortar: new AbortController(),
    criadoEm: Date.now(),
    visitadoEm: Date.now(),
    arquivos: novo.arquivos,
    bytes: novo.bytes,
  };
  jobs.set(job.id, job);
  // Sem `await`: a resposta sai agora e o trabalho segue. É a inversão inteira
  // deste arquivo. A promessa é consumida aqui mesmo (`void` + `catch` dentro
  // de `executar`), então nada vira rejeição não tratada.
  void executar(job);
  return job;
}

/**
 * Roda o scanner e guarda o desfecho no job.
 *
 * NUNCA lança: quem chama não está esperando ninguém. Toda falha vira
 * `status: "error"` com o texto redigido — que é o que o cliente vai ler.
 *
 * **O estado terminal é publicado DEPOIS de o disco estar limpo.** O desfecho
 * fica numa variável local até o `finally` apagar o temporário; só então vai
 * para o `job`. A ordem inversa — que era a daqui — deixava uma janela em que o
 * cliente podia ler `status: "done"` com o código-fonte dele ainda no disco do
 * servidor. A janela é de milissegundos e nunca causou defeito visível; ela
 * importa porque "os arquivos existem durante o scan e são apagados depois" é a
 * frase que sustenta esta rota inteira, e uma frase dessas se cumpre no relógio
 * de quem lê, não no nosso.
 */
async function executar(job: ScanJob): Promise<void> {
  const comecou = Date.now();
  let desfecho: Pick<ScanJob, "status" | "result" | "error" | "unavailable"> = {
    status: "error",
    error: "O scan terminou sem desfecho.",
  };
  try {
    const dir = job.dir!;
    // Import dinâmico: o núcleo é NODE-ONLY e não deve ser carregado no
    // caminho de módulos do edge.
    const { runSast } = await import("@starguard/core/analyzers/sast");
    const { runSca } = await import("@starguard/core/analyzers/sca");
    const { enrichFindings, enrichDependencies } = await import("@starguard/core/enrich");

    // A vaga é tomada DENTRO de `runSast`/`runSca` (ver `scan-slot.ts` do
    // núcleo), e não aqui. Assim a análise pedida pelo painel web — que chama
    // as mesmas funções por `lib/jobs.ts`, sem passar por rota nenhuma —
    // disputa a MESMA vaga. Uma fila que só a extensão respeitava não protegia
    // a caixa de nada.
    //
    // O `report` é como o job descobre em qual dos dois estados ele está.
    // Marcar `running` já na entrada era mentira: entre pedir a vaga e recebê-la
    // pode haver minutos, e o cliente mostrava "escaneando no servidor" para
    // quem ainda estava atrás de outra pessoa na fila — sem número, sem
    // previsão, indistinguível de travado.
    const opcoes = {
      signal: job.abortar.signal,
      // O idioma de quem PEDIU, e não o do servidor: o erro que `runSast` lança
      // é gravado e exibido como está (ver CLAUDE.md — texto do JSONB sai já
      // traduzido). Sem isto, um teto estourado chegava em português para quem
      // usa o editor em inglês.
      locale: job.locale,
      report: (chave: string, valores?: Record<string, string | number>) => {
        // As CONSTANTES do núcleo, e não literais repetidas aqui.
        //
        // Quem escaneia neste ponto é o servidor, localmente; a frase "no
        // servidor" é montada pelo CLIENTE ao ver `running`. Enquanto os dois
        // lados comparavam literais escritas à mão, bastava renomear a chave no
        // analisador para o job nunca mais sair de `queued` — e o cliente
        // mostrar fila eterna com o scan rodando até o fim. Tipo, lint e testes
        // passam os três diante de duas strings que deixaram de coincidir.
        if (chave === MSG_VAGA_NA_FILA) {
          job.status = "queued";
          job.vaga = typeof valores?.n === "number" ? valores.n : undefined;
        } else if (chave === MSG_ESCANEANDO_LOCAL) {
          job.status = "running";
          job.vaga = undefined;
        }
      },
    };
    let bruto:
      | Awaited<ReturnType<typeof runSast>>
      | Awaited<ReturnType<typeof runSca>>
      | undefined =
      job.analyzer === "sast" ? await runSast(dir, opcoes) : await runSca(dir, opcoes);

    if (job.abortar.signal.aborted) {
      desfecho = { status: "cancelled" };
      return;
    }

    // O enriquecimento acontece AQUI, e só aqui.
    //
    // O cliente não repete: enriquecer de novo do lado dele era uma segunda
    // chamada de IA, paga, pelo mesmo texto. Ver `analyzers/sast.ts`.
    const result =
      job.analyzer === "sast"
        ? await enrichFindings(bruto as Awaited<ReturnType<typeof runSast>>, job.locale)
        : enrichDependencies(bruto as Awaited<ReturnType<typeof runSca>>, job.locale);
    // O parser cru e o enriquecido são arrays distintos. Depois do
    // enriquecimento, manter o primeiro referenciado até o `finally` dobra a
    // parte mais pesada do heap sem nenhuma utilidade.
    bruto = undefined;
    desfecho = { status: "done", result };

    audit(
      "scan.remote",
      {
        analyzer: job.analyzer,
        files: job.arquivos,
        bytes: job.bytes,
        ms: Date.now() - comecou,
        findings: Array.isArray(result) ? result.length : 0,
      },
      job.userId
    );
  } catch (e) {
    if (job.abortar.signal.aborted) {
      desfecho = { status: "cancelled" };
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const { redact } = await import("@starguard/core/redact");
    desfecho = {
      status: "error",
      error: redact(msg),
      // Binário ausente no servidor não é "o scan falhou": o cliente precisa
      // distinguir para poder cair no binário da máquina dele.
      unavailable: /não encontrado|not found|ENOENT/i.test(msg),
    };
  } finally {
    // O compromisso inteiro desta rota mora nesta linha: o código de outra
    // pessoa não sobrevive ao scan. O RESULTADO fica na memória pelo TTL; os
    // ARQUIVOS vão embora agora, terminando bem ou mal.
    await apagarDiretorio(job);

    // E SÓ AGORA o desfecho fica visível. Um job cancelado no meio já saiu do
    // mapa e não volta a ter estado — publicar aqui o ressuscitaria como "done".
    if (!job.abortar.signal.aborted) {
      job.status = desfecho.status;
      job.result = desfecho.result;
      job.error = desfecho.error;
      job.unavailable = desfecho.unavailable;
    }
    job.terminadoEm = Date.now();
  }
}

async function apagarDiretorio(job: ScanJob): Promise<void> {
  const dir = job.dir;
  if (!dir) return;
  job.dir = null;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Para o job: mata o processo, esquece o resultado, apaga o temporário.
 *
 * **Síncrono no que importa.** A remoção do mapa e o `abort` acontecem antes de
 * qualquer `await`, e não depois — porque quem cancela costuma contar a fila na
 * linha seguinte. Com a remoção pendurada num `await rm()`, um job cancelado
 * continuava aparecendo como existente por alguns milissegundos, e o teto por
 * pessoa deixava passar um job a mais. O apagar do disco é lento e não interessa
 * a ninguém: vai para segundo plano.
 *
 * Idempotente de propósito — o `DELETE` do cliente e o recolhimento por
 * abandono chegam juntos com frequência, e cancelar duas vezes não pode virar
 * erro.
 */
export function cancelarJob(job: ScanJob): void {
  if (job.status === "queued" || job.status === "running") {
    job.status = "cancelled";
    job.abortar.abort();
  }
  job.result = undefined;
  jobs.delete(job.id);
  void apagarDiretorio(job);
}

/**
 * Recolhe o que ninguém quer mais.
 *
 * Duas regras, e a primeira é a que conserta o defeito relatado:
 *
 * - **abandonado** — sem consulta há mais de `ABANDONO_MS` e ainda rodando.
 *   Cancelar libera a vaga, mata o opengrep e devolve a instância a quem
 *   estiver esperando. Era isto que não existia.
 * - **vencido** — terminado há mais de `TTL_MS`. Só ocupa memória.
 *
 * Chamado a cada requisição da rota, e não por temporizador: é barato (o mapa
 * tem unidades de entradas), acontece exatamente quando há atividade e não
 * segura o processo vivo com um `setInterval` que a plataforma não espera.
 */
export function recolherAbandonados(): { abandonados: number; vencidos: number } {
  const agora = Date.now();
  let abandonados = 0;
  let vencidos = 0;

  for (const job of [...jobs.values()]) {
    const ativo = job.status === "queued" || job.status === "running";
    if (ativo && agora - job.visitadoEm > ABANDONO_MS) {
      abandonados++;
      audit(
        "scan.abandoned",
        { analyzer: job.analyzer, ms: agora - job.criadoEm },
        job.userId
      );
      cancelarJob(job);
      continue;
    }
    if (!ativo && job.terminadoEm && agora - job.terminadoEm > TTL_MS) {
      vencidos++;
      jobs.delete(job.id);
      void apagarDiretorio(job);
    }
  }
  return { abandonados, vencidos };
}

/**
 * Mantém no máximo `POR_PESSOA` jobs vivos por dono, derrubando o ABANDONADO.
 *
 * A ordem era por `criadoEm` — o mais VELHO caía primeiro — e isso derrubava o
 * job errado no caso mais comum de todos. Quando o envio do `sast` estoura o
 * teto de 120 s numa conexão doméstica, o cliente repete o POST; o primeiro
 * envio já criou um job do lado de cá, e o segundo cria outro. Com o `sca` esse
 * é o terceiro — e o mais velho, o que o critério antigo escolhia para morrer,
 * é justamente o que o cliente está acompanhando. A pessoa recebia
 * "O scan foi perdido pelo servidor" por causa de uma retentativa do próprio
 * cliente dela.
 *
 * `visitadoEm` responde a pergunta certa: **quem aqui ninguém está esperando?**
 * O órfão de um envio repetido nunca é consultado, e é ele quem cai. O critério
 * de idade sobra só para o desempate.
 */
function limitarPorPessoa(userId: string): void {
  const meus = [...jobs.values()]
    .filter((j) => j.userId === userId && (j.status === "queued" || j.status === "running"))
    .sort((a, b) => a.visitadoEm - b.visitadoEm || a.criadoEm - b.criadoEm);
  while (meus.length >= POR_PESSOA) {
    const esquecido = meus.shift()!;
    audit(
      "scan.replaced",
      { analyzer: esquecido.analyzer, semConsultaMs: Date.now() - esquecido.visitadoEm },
      userId
    );
    cancelarJob(esquecido);
  }
}

/** Marca que alguém ainda quer este resultado. É o batimento cardíaco do job. */
export function tocarJob(job: ScanJob): void {
  job.visitadoEm = Date.now();
}

/** **Só para teste.** Em produção os jobs saem pelo cancelamento ou pelo TTL. */
export function limparJobs(): void {
  for (const j of jobs.values()) j.abortar.abort();
  jobs.clear();
}

/**
 * Varre temporários de scan que sobraram de um processo ANTERIOR.
 *
 * O `finally` de cada scan apaga o seu diretório, e isso cobre tudo o que
 * acontece dentro de uma vida do processo. Não cobre a morte do processo: um
 * `OOM kill` — que é justamente o que este servidor vinha sofrendo — mata o Node
 * entre o `writeFile` e o `rm`, e o `sg-scan-*` fica no disco com código de
 * outra pessoa dentro.
 *
 * "Nada é persistido" é a promessa central desta rota. Uma promessa que só vale
 * quando o processo termina bem não é a promessa que está escrita no cabeçalho.
 *
 * Roda uma vez, na carga do módulo, e só remove o que tem mais de uma hora —
 * outra instância pode estar escaneando agora, e o `tmpdir` pode ser
 * compartilhado.
 */
async function varrerRestosAntigos(): Promise<void> {
  const LIMITE_MS = 60 * 60_000;
  try {
    const { readdir, stat } = await import("node:fs/promises");
    const raiz = tmpdir();
    for (const nome of await readdir(raiz)) {
      if (!nome.startsWith("sg-scan-")) continue;
      const caminho = join(raiz, nome);
      try {
        const info = await stat(caminho);
        if (Date.now() - info.mtimeMs < LIMITE_MS) continue;
        await rm(caminho, { recursive: true, force: true });
      } catch {
        /* sumiu no meio, ou é de outro dono: seguir */
      }
    }
  } catch {
    /* sem `tmpdir` legível não há o que varrer */
  }
}

// Uma vez por processo, e sem `await`: a varredura não pode atrasar a primeira
// requisição. `__sg_scan_varrido` no global porque o hot reload do Next reavalia
// o módulo, e varrer a cada salvamento em desenvolvimento seria desperdício.
const gv = globalThis as unknown as { __sg_scan_varrido?: boolean };
if (!gv.__sg_scan_varrido) {
  gv.__sg_scan_varrido = true;
  void varrerRestosAntigos();
}
