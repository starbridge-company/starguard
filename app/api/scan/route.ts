// ============================================================
// Scan no servidor — AUDITORIA.md#ARQ-14, #ARQ-16.
//
// Por que existe: quem instala a extensão do VS Code **não deve precisar
// instalar nada**. `opengrep` e `trivy` vivem na nossa imagem Docker; os
// arquivos vêm até eles.
//
// Esta rota é o ponto onde código de outra pessoa entra na nossa máquina, e
// isso governa cada decisão abaixo:
//
//  1. **Nada é persistido.** Os arquivos são escritos num diretório temporário
//     com nome aleatório, escaneados, e o diretório é removido assim que o
//     scanner termina — bem ou mal. Não há gravação em banco, em log ou em
//     cache. O que fica registrado é metadado: quem pediu, qual analisador,
//     quantos arquivos, quanto demorou.
//  2. **O caminho de cada arquivo é tratado como hostil.** Ele vem do cliente,
//     e um `../` aceito escreveria fora do diretório temporário — que é
//     escrita arbitrária no servidor. Cada caminho é normalizado e confinado.
//  3. **Teto de tamanho antes de tocar no disco.** Sem isso, um cliente
//     autenticado enche o disco da instância.
//  4. **Bearer apenas.** É rota de ferramenta; não há caminho de navegador
//     aqui, e portanto nenhuma credencial de cookie serve.
//
// ---- O que mudou, e por quê ----
//
// A rota escaneava DENTRO da requisição e devolvia os achados na mesma
// resposta. Isso funciona enquanto o scan cabe no tempo de uma requisição — e
// um SAST numa instância pequena não cabe. Passado o teto do cliente, ele
// abortava o `fetch` e **aqui nada acontecia**: o opengrep seguia rodando, a
// vaga seguia ocupada, e cada nova tentativa somava mais um scan órfão até a
// fila ficar permanentemente cheia. Quem usava relatava "a fila nunca é
// limpa"; a fila estava certa, o que faltava era alguém sair dela.
//
// Agora o trabalho é um JOB (ver `lib/scan-jobs.ts`):
//
//   POST   /api/scan            aceita e responde 202 {jobId, position}
//   GET    /api/scan?job=<id>   estado: queued | running | done | error
//   DELETE /api/scan?job=<id>   mata o processo e apaga o temporário
//   GET    /api/scan            os tetos do servidor, para o cliente empacotar
//                               exatamente o que cabe em vez de adivinhar
//
// Nenhuma requisição passa de segundos, o que tira do caminho todo intermediário
// que mata conexão longa (CDN, proxy de empresa, teto da plataforma) — e essa
// era a outra metade dos "403 sem corpo JSON" que a extensão relatava.
//
// **O modo síncrono continua existindo** para a geração anterior do cliente:
// sem `mode: "async"` no corpo, a rota escaneia e devolve `{result}` como
// sempre fez. Exigir versões casadas abriria uma janela em que quem tem a
// extensão antiga instalada não consegue analisar nada.
// ============================================================
import type { NextRequest } from "next/server";
import { rm } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { jsonError, jsonOk, readJson, requireSession, credentialSource } from "@/lib/http";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { normalizeLocale } from "@/lib/i18n/config";
import {
  acharJob,
  cancelarJob,
  criarJob,
  jobsAtivos,
  posicaoNaFila,
  prepararDiretorio,
  recolherAbandonados,
  tocarJob,
} from "@/lib/scan-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Só o modo síncrono (cliente antigo) precisa disto. No modo job a resposta sai
// em segundos, e é justamente essa a razão de o modo job existir.
export const maxDuration = 300;

/**
 * Teto do pacote. Acima disto a resposta é 413, antes de escrever no disco.
 *
 * Configurável por ambiente porque o teto certo é o da CAIXA, e quem hospeda é
 * quem sabe qual é. O padrão vale para uma instância pequena: um pacote que o
 * servidor aceita e não consegue processar é pior que um recusado — ele derruba
 * a instância, e com ela as requisições dos vizinhos (AUDITORIA.md#ARQ-15).
 *
 * Estes números são PUBLICADOS no `GET /api/scan`. Enquanto não eram, o cliente
 * empacotava pelo palpite dele (12 MB e 1200 arquivos, contra 8 MB e 800 daqui)
 * e todo projeto de tamanho médio levava 413 na primeira tentativa — para
 * então ser dividido em duas metades e escaneado DUAS vezes, cada uma
 * carregando o ruleset inteiro. Era uma lentidão garantida por configuração,
 * não por acidente de rede.
 */
const MAX_BYTES = Number(process.env.SCAN_MAX_BYTES) || 8 * 1024 * 1024;
const MAX_FILES = Number(process.env.SCAN_MAX_FILES) || 800;

interface ArquivoRecebido {
  path: string;
  content: string;
}

/**
 * Quantos jobs podem existir antes de recusarmos de imediato.
 *
 * Folgado, e agora com sentido: o que ocupa a caixa é a VAGA do scanner
 * (`scan-slot.ts` do núcleo), não o job. Um job na fila custa memória de um
 * diretório temporário; ele espera a vez sem competir por CPU com ninguém.
 * Este teto só existe para o caso de muita gente ao mesmo tempo — e mesmo nele
 * a recusa é `429` com `Retry-After`, que o cliente espera e repete.
 */
const FILA_MAX = Number(process.env.SCAN_QUEUE_MAX) || 8;

/**
 * O caminho relativo, ou `null` se ele tentar sair da raiz.
 *
 * Recusa: caminho absoluto, `..` em qualquer posição, e o caso do Windows
 * (`C:\…`, e a barra invertida como separador). Isto é o que separa "escrever
 * num diretório temporário" de "escrever onde o cliente mandar".
 */
export function caminhoSeguro(bruto: string): string | null {
  if (!bruto || bruto.length > 400) return null;
  // O byte nulo trunca a string em chamadas de sistema de alguns runtimes.
  if (bruto.includes("\u0000")) return null;

  const unificado = bruto.replace(/\\/g, "/");
  if (isAbsolute(unificado) || /^[A-Za-z]:/.test(unificado)) return null;
  if (unificado.startsWith("/")) return null;

  const limpo = normalize(unificado).replace(/\\/g, "/");
  if (limpo.startsWith("..") || limpo.split("/").includes("..")) return null;
  if (limpo === "." || limpo === "") return null;
  return limpo;
}

/** Autenticação e origem da credencial — igual nos três métodos. */
async function porteiro(req: NextRequest) {
  const sessao = await requireSession(req);
  if (!sessao) {
    return { erro: jsonError(401, "Não autenticado.", "err.unauthenticated") };
  }
  // Rota de ferramenta: cookie não serve. Fecha a porta para um site de
  // terceiro induzir o navegador de alguém logado a mandar código para cá.
  if (credentialSource(req) !== "bearer") {
    return {
      erro: jsonError(403, "Esta rota aceita apenas token de aplicativo.", "err.forbidden"),
    };
  }
  return { sessao };
}

// ------------------------------------------------------------
// POST — aceitar o trabalho
// ------------------------------------------------------------

export async function POST(req: NextRequest) {
  const { sessao, erro } = await porteiro(req);
  if (erro) return erro;

  const ip = clientIp(req.headers);
  const rl = await rateLimit(`scan:${sessao!.sub}:${ip}`, { max: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return jsonError(429, "Muitos scans seguidos. Tente em instantes.", "err.tooManyRequests");
  }

  // Recolher ANTES de contar. É o que impede um órfão de ontem de recusar o
  // trabalho de hoje — e é a linha que fazia falta.
  recolherAbandonados();

  // Recusar CEDO, com corpo e status honestos, é melhor que aceitar e morrer:
  // a instância derrubada não responde nem a esta requisição nem às dos outros.
  if (jobsAtivos() >= FILA_MAX) {
    const res = jsonError(
      429,
      "Há scans demais em andamento neste servidor. Tente em instantes.",
      "err.tooManyRequests"
    );
    res.headers.set("Retry-After", "20");
    return res;
  }

  // ---- O TAMANHO é conferido ANTES de o corpo ser lido ----
  //
  // `MAX_BYTES` era checado depois de `readJson`, ou seja, depois de o JSON
  // inteiro já ter sido bufferizado E parseado na memória. Numa instância de
  // 512 MB isso torna o teto decorativo: um cliente autenticado que mande 300 MB
  // derruba o processo antes de a primeira linha de validação rodar — e derruba
  // junto as requisições de todo mundo, que é exatamente o modo de falha do
  // ARQ-15. O `content-length` custa uma leitura de cabeçalho.
  //
  // A folga de 2× cobre o inchaço do JSON sobre o conteúdo cru (escapes, nomes
  // de campo, aspas). O teto exato continua sendo aplicado abaixo, sobre os
  // bytes de verdade.
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > MAX_BYTES * 2) {
    return limiteExcedido("Pacote grande demais.");
  }

  const corpo = (await readJson(req)) as {
    analyzer?: string;
    locale?: string;
    mode?: string;
    files?: ArquivoRecebido[];
  } | null;

  const analyzer = corpo?.analyzer;
  if (analyzer !== "sast" && analyzer !== "sca") {
    return jsonError(400, "Analisador inválido.", "err.badRequest");
  }
  const files = Array.isArray(corpo?.files) ? corpo!.files! : [];
  if (files.length === 0) return jsonError(400, "Nenhum arquivo enviado.", "err.badRequest");
  if (files.length > MAX_FILES) {
    return limiteExcedido("Arquivos demais para um scan.");
  }

  let bytes = 0;
  for (const f of files) {
    if (typeof f?.path !== "string" || typeof f?.content !== "string") {
      return jsonError(400, "Arquivo malformado.", "err.badRequest");
    }
    bytes += f.content.length;
    if (bytes > MAX_BYTES) return limiteExcedido("Pacote grande demais.");
  }

  // Caminhos hostis são descartados, não são motivo de erro — mas se NENHUM
  // sobrar, não há o que escanear.
  const aprovados: { rel: string; content: string }[] = [];
  for (const f of files) {
    const rel = caminhoSeguro(f.path);
    if (rel) aprovados.push({ rel, content: f.content });
  }
  if (aprovados.length === 0) {
    return jsonError(400, "Nenhum caminho de arquivo utilizável.", "err.badRequest");
  }

  // ---- A ÚNICA referência ao conteúdo passa a ser `aprovados` ----
  //
  // `prepararDiretorio` solta cada string assim que ela chega ao disco, para o
  // pico deixar de ser "o pacote inteiro em memória" e virar "um arquivo de cada
  // vez". Isso só vale se ninguém MAIS estiver segurando as mesmas strings — e
  // `corpo.files` estava, do começo ao fim da requisição, porque `corpo` vive
  // até o `return`. Duas referências para o mesmo objeto, e o coletor não pode
  // recuperar nada enquanto uma delas existir: sem esta linha a otimização do
  // outro lado é teatro.
  //
  // `bytes` e `files.length` já foram medidos acima; nada abaixo lê `corpo`.
  if (corpo) corpo.files = undefined;

  const locale = normalizeLocale(corpo?.locale);
  const { dir, escritos } = await prepararDiretorio(aprovados);
  if (escritos === 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return jsonError(400, "Nenhum caminho de arquivo utilizável.", "err.badRequest");
  }

  // O temporário só passa a ter dono quando o job existe. Se `criarJob` falhar,
  // ninguém mais conhece este diretório — e um diretório com código de outra
  // pessoa esquecido no disco é a única promessa que esta rota não pode quebrar.
  let job;
  try {
    job = criarJob({
      userId: sessao!.sub,
      analyzer,
      locale,
      dir,
      arquivos: escritos,
      bytes,
    });
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }

  // ---- Cliente antigo: escaneia aqui e devolve o resultado ----
  //
  // Ele não sabe consultar estado, então a única resposta que serve para ele é
  // a completa. Continua exposto a todos os problemas de uma requisição longa —
  // é o desenho que ele conhece — mas pelo menos o trabalho agora é cancelável e
  // recolhível como qualquer outro job.
  if (corpo?.mode !== "async") {
    const pronto = await esperarJob(job.id, sessao!.sub);
    if (pronto === "gone") {
      return jsonError(500, "O scan foi perdido durante a execução.", "err.server");
    }
    if (pronto === "timeout") {
      // 504 e não 500: é tempo, não defeito, e o cliente antigo trata 5xx como
      // motivo para tentar de novo em vez de mostrar "o scan falhou".
      return jsonError(504, "O scan passou do tempo desta requisição.", null);
    }
    if (pronto.status === "error") {
      return jsonError(pronto.unavailable ? 503 : 500, pronto.error ?? "Falha no scan.", null);
    }
    if (pronto.status === "cancelled") {
      // Acontece quando um terceiro pedido da mesma pessoa derruba este (ver
      // `limitarPorPessoa`). 409 e não 499: o segundo é do nginx, não do HTTP, e
      // há intermediário que o trata como resposta inválida.
      return jsonError(409, "O scan foi substituído por outro do mesmo usuário.", null);
    }
    return jsonOk({ result: pronto.result });
  }

  return jsonOk(
    { jobId: job.id, status: job.status, position: posicaoNaFila(job.id) },
    202
  );
}

/** 413 com os tetos JUNTO: o cliente reempacota certo em vez de dividir no escuro. */
function limiteExcedido(mensagem: string) {
  const res = jsonError(413, mensagem, "err.tooLarge");
  res.headers.set("X-Scan-Max-Files", String(MAX_FILES));
  res.headers.set("X-Scan-Max-Bytes", String(MAX_BYTES));
  return res;
}

/**
 * Espera o job terminar — **só para o cliente da geração anterior**.
 *
 * O polling interno é o mesmo mecanismo do cliente novo, e mantém o job vivo
 * (`tocarJob`) para que o recolhimento por abandono não o mate no meio.
 *
 * **Com prazo**, e o prazo é menor que o `maxDuration` da rota. Sem ele este
 * laço não tinha condição de parada nenhuma: um scanner que travasse deixaria a
 * requisição aberta pelo tempo que a plataforma tolerasse, segurando uma conexão
 * e um `setTimeout` a cada meio segundo. É o mesmo erro do desenho antigo — não
 * existir saída — reintroduzido na compatibilidade, e por isso vale um teto
 * explícito em vez da confiança em quem hospeda.
 */
const ESPERA_SINCRONA_MS = Number(process.env.SCAN_SYNC_DEADLINE_MS) || 240_000;

async function esperarJob(
  id: string,
  userId: string
): Promise<
  | "gone"
  | "timeout"
  | { status: string; result?: unknown; error?: string; unavailable?: boolean }
> {
  const ate = Date.now() + ESPERA_SINCRONA_MS;
  for (;;) {
    const job = acharJob(id, userId);
    if (!job) return "gone";
    tocarJob(job);
    if (job.status !== "queued" && job.status !== "running") {
      return {
        status: job.status,
        result: job.result,
        error: job.error,
        unavailable: job.unavailable,
      };
    }
    if (Date.now() > ate) {
      // Desistir de ESPERAR não é desistir do trabalho: o job segue, e é
      // recolhido por abandono se ninguém voltar. Matá-lo aqui jogaria fora um
      // scan que talvez estivesse a segundos de terminar.
      return "timeout";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ------------------------------------------------------------
// GET — estado do job, ou os tetos do servidor
// ------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { sessao, erro } = await porteiro(req);
  if (erro) return erro;

  const id = req.nextUrl.searchParams.get("job");

  // ---- O BATIMENTO VEM ANTES DA VARREDURA ----
  //
  // `recolherAbandonados()` era a primeira linha desta rota, e `tocarJob` a
  // décima. Nessa ordem, uma consulta que chegasse um segundo depois de
  // `ABANDONO_MS` **matava o próprio job que ela vinha buscar**: a varredura via
  // o silêncio, recolhia, e o `acharJob` logo abaixo devolvia 404. O cliente
  // então dizia "O scan foi perdido pelo servidor (ele pode ter reiniciado)" —
  // uma frase falsa duas vezes, porque o servidor não reiniciou e quem perdeu o
  // scan foi esta requisição, que era exatamente a prova de que alguém ainda o
  // queria.
  //
  // Basta uma janela de rede fechada, uma máquina que suspendeu ou um proxy que
  // engoliu algumas consultas para o relógio passar de um minuto. O desenho já
  // previa isso do lado do cliente (ele tolera consultas perdidas em vez de
  // jogar fora o scan); o servidor é que desfazia a tolerância antes de ela
  // poder valer.
  const job = id ? acharJob(id, sessao!.sub) : undefined;
  if (job) tocarJob(job);

  recolherAbandonados();

  if (!id) {
    // Sem job: os tetos. É o que permite ao cliente empacotar exatamente o que
    // cabe, em vez de mandar demais e ser recusado.
    return jsonOk({ maxFiles: MAX_FILES, maxBytes: MAX_BYTES, active: jobsAtivos() });
  }

  if (!job) return jsonError(404, "Scan não encontrado.", "err.notFound");

  if (job.status === "queued") {
    return jsonOk({ status: "queued", position: posicaoNaFila(job.id) });
  }
  if (job.status === "running") return jsonOk({ status: "running" });
  if (job.status === "cancelled") return jsonOk({ status: "cancelled" });
  if (job.status === "error") {
    return jsonOk({ status: "error", error: job.error, unavailable: job.unavailable });
  }
  return jsonOk({ status: "done", result: job.result });
}

// ------------------------------------------------------------
// DELETE — parar de verdade
// ------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  const { sessao, erro } = await porteiro(req);
  if (erro) return erro;

  const id = req.nextUrl.searchParams.get("job");
  if (!id) return jsonError(400, "Scan não informado.", "err.badRequest");

  const job = acharJob(id, sessao!.sub);
  // Cancelar o que já não existe é sucesso, não erro: o `DELETE` chega junto
  // com o recolhimento por abandono mais vezes do que se imagina, e devolver
  // 404 ali faria a extensão registrar uma falha por ter feito a coisa certa.
  if (!job) return jsonOk({ status: "cancelled" });

  cancelarJob(job);
  recolherAbandonados();
  return jsonOk({ status: "cancelled" });
}
