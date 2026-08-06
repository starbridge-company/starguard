// ============================================================
// Scan no servidor — AUDITORIA.md#ARQ-14.
//
// Por que existe: quem instala a extensão do VS Code **não deve precisar
// instalar nada**. `opengrep` e `trivy` vivem na nossa imagem Docker; os
// arquivos vêm até eles.
//
// Esta rota é o ponto onde código de outra pessoa entra na nossa máquina, e
// isso governa cada decisão abaixo:
//
//  1. **Nada é persistido.** Os arquivos são escritos num diretório temporário
//     com nome aleatório, escaneados, e o diretório é removido no `finally`.
//     Não há gravação em banco, em log ou em cache. O que fica registrado é
//     metadado: quem pediu, qual analisador, quantos arquivos, quanto demorou.
//  2. **O caminho de cada arquivo é tratado como hostil.** Ele vem do cliente,
//     e um `../` aceito escreveria fora do diretório temporário — que é
//     escrita arbitrária no servidor. Cada caminho é normalizado e confinado.
//  3. **Teto de tamanho antes de tocar no disco.** Sem isso, um cliente
//     autenticado enche o disco da instância.
//  4. **Bearer apenas.** É rota de ferramenta; não há caminho de navegador
//     aqui, e portanto nenhuma credencial de cookie serve.
// ============================================================
import type { NextRequest } from "next/server";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, sep } from "node:path";
import { jsonError, jsonOk, readJson, requireSession, credentialSource } from "@/lib/http";
import { audit } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { normalizeLocale } from "@/lib/i18n/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Um scan de repositório grande passa dos 30 s padrão de algumas plataformas.
export const maxDuration = 300;

/**
 * Teto do pacote. Acima disto a resposta é 413, antes de escrever no disco.
 *
 * Configurável por ambiente porque o teto certo é o da CAIXA, e quem hospeda é
 * quem sabe qual é. O padrão vale para uma instância pequena: um pacote que o
 * servidor aceita e não consegue processar é pior que um recusado — ele derruba
 * a instância, e com ela as requisições dos vizinhos (AUDITORIA.md#ARQ-15).
 *
 * Recusar aqui não deixa ninguém sem análise: o cliente divide o pacote e
 * reenvia em partes. Ver `callRemoteScanPartido`.
 */
const MAX_BYTES = Number(process.env.SCAN_MAX_BYTES) || 8 * 1024 * 1024;
const MAX_FILES = Number(process.env.SCAN_MAX_FILES) || 800;

interface ArquivoRecebido {
  path: string;
  content: string;
}

/**
 * UM scan por vez nesta instância — AUDITORIA.md#ARQ-15.
 *
 * O cliente pede `sast` e `sca` EM PARALELO, porque do lado dele são dois
 * analisadores independentes. Do lado de cá são dois scanners nativos famintos
 * dividindo a mesma caixa: o opengrep carrega o ruleset inteiro e o trivy sobe
 * o banco de vulnerabilidades. Juntos, numa instância de 512 MB, o kernel mata
 * o processo — e aí não morre um scan, morre o SERVIDOR, levando junto todas as
 * requisições em voo. Foi o que produziu "403 no sast e 502 no sca no mesmo
 * segundo", nenhum dos dois com corpo JSON.
 *
 * Serializar é o que transforma "a instância caiu" em "espere sua vez". A fila
 * é por instância (estado de módulo): não é coordenação distribuída, é a defesa
 * mínima de quem está com o processo na mão. Com mais de uma instância, cada
 * uma protege a si mesma, que é exatamente o necessário.
 */
let filaDeScan: Promise<unknown> = Promise.resolve();
let scansNaFila = 0;

/**
 * Quantos podem esperar antes de recusarmos de imediato.
 *
 * Folgado de propósito: o CLIENTE já serializa os scans dele (ver
 * `scan-transport.ts`), então um editor sozinho nunca chega aqui. Este teto
 * existe para o caso de várias pessoas ao mesmo tempo — e mesmo nele a recusa é
 * `429` com `Retry-After`, que o cliente espera e repete em vez de desistir.
 */
const FILA_MAX = Number(process.env.SCAN_QUEUE_MAX) || 4;

async function naFila<T>(fn: () => Promise<T>): Promise<T> {
  scansNaFila++;
  const minhaVez = filaDeScan.then(fn, fn);
  // A fila encadeia o DESFECHO, não o resultado: um scan que falha não pode
  // travar a fila para sempre.
  filaDeScan = minhaVez.then(
    () => undefined,
    () => undefined
  );
  try {
    return await minhaVez;
  } finally {
    scansNaFila--;
  }
}

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

export async function POST(req: NextRequest) {
  const sessao = await requireSession(req);
  if (!sessao) return jsonError(401, "Não autenticado.", "err.unauthenticated");

  // Rota de ferramenta: cookie não serve. Fecha a porta para um site de
  // terceiro induzir o navegador de alguém logado a mandar código para cá.
  if (credentialSource(req) !== "bearer") {
    return jsonError(403, "Esta rota aceita apenas token de aplicativo.", "err.forbidden");
  }

  const ip = clientIp(req.headers);
  const rl = await rateLimit(`scan:${sessao.sub}:${ip}`, { max: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return jsonError(429, "Muitos scans seguidos. Tente em instantes.", "err.tooManyRequests");
  }

  // Recusar CEDO, com corpo e status honestos, é melhor que aceitar e morrer:
  // a instância derrubada não responde nem a esta requisição nem às dos outros.
  if (scansNaFila >= FILA_MAX) {
    const res = jsonError(429, "Outro scan está em andamento. Tente em instantes.", "err.tooManyRequests");
    res.headers.set("Retry-After", "20");
    return res;
  }

  const corpo = (await readJson(req)) as {
    analyzer?: string;
    locale?: string;
    files?: ArquivoRecebido[];
  } | null;

  const analyzer = corpo?.analyzer;
  if (analyzer !== "sast" && analyzer !== "sca") {
    return jsonError(400, "Analisador inválido.", "err.badRequest");
  }
  const files = Array.isArray(corpo?.files) ? corpo!.files! : [];
  if (files.length === 0) return jsonError(400, "Nenhum arquivo enviado.", "err.badRequest");
  if (files.length > MAX_FILES) {
    return jsonError(413, "Arquivos demais para um scan.", "err.tooLarge");
  }

  let bytes = 0;
  for (const f of files) {
    if (typeof f?.path !== "string" || typeof f?.content !== "string") {
      return jsonError(400, "Arquivo malformado.", "err.badRequest");
    }
    bytes += f.content.length;
    if (bytes > MAX_BYTES) return jsonError(413, "Pacote grande demais.", "err.tooLarge");
  }

  const locale = normalizeLocale(corpo?.locale);
  const comecou = Date.now();
  let raiz: string | null = null;

  try {
    raiz = await mkdtemp(join(tmpdir(), "sg-scan-"));

    let escritos = 0;
    for (const f of files) {
      const rel = caminhoSeguro(f.path);
      if (!rel) continue; // caminho hostil: descartado, não é motivo de erro
      const destino = join(raiz, rel);
      // Cinto e suspensório: mesmo depois de `caminhoSeguro`, confere que o
      // absoluto resultante continua dentro da raiz.
      if (!destino.startsWith(raiz + sep)) continue;
      await mkdir(join(destino, ".."), { recursive: true });
      await writeFile(destino, f.content, "utf8");
      escritos++;
    }
    if (escritos === 0) {
      return jsonError(400, "Nenhum caminho de arquivo utilizável.", "err.badRequest");
    }

    // Import dinâmico: o núcleo é NODE-ONLY e não deve ser carregado no
    // caminho de módulos do edge.
    const { runSast } = await import("@starguard/core/analyzers/sast");
    const { runSca } = await import("@starguard/core/analyzers/sca");
    const { enrichFindings, enrichDependencies } = await import("@starguard/core/enrich");

    // O scanner nativo roda na FILA; o enriquecimento não. Só o primeiro
    // disputa memória com o vizinho — segurar a fila durante a chamada de IA
    // faria um scan barato esperar por uma tradução de texto.
    // `const` local: dentro da closure da fila, o compilador não sabe que
    // `raiz` (que o `finally` precisa ver mutável) já foi atribuída.
    const dir = raiz;
    const bruto =
      analyzer === "sast"
        ? await naFila(() => runSast(dir))
        : await naFila(() => runSca(dir));

    const result =
      analyzer === "sast"
        ? await enrichFindings(bruto as Awaited<ReturnType<typeof runSast>>, locale)
        : await enrichDependencies(bruto as Awaited<ReturnType<typeof runSca>>, locale);

    audit(
      "scan.remote",
      {
        analyzer,
        files: escritos,
        bytes,
        ms: Date.now() - comecou,
        findings: Array.isArray(result) ? result.length : 0,
      },
      sessao.sub
    );

    return jsonOk({ result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Binário ausente no servidor é 503, não 500: o cliente precisa
    // distinguir "não dá para escanear agora" de "o scan falhou".
    const semBinario = /não encontrado|not found|ENOENT/i.test(msg);
    const { redact } = await import("@starguard/core/redact");
    return jsonError(semBinario ? 503 : 500, redact(msg), null);
  } finally {
    // O compromisso inteiro desta rota mora nesta linha: o código de outra
    // pessoa não sobrevive à requisição.
    if (raiz) await rm(raiz, { recursive: true, force: true }).catch(() => {});
  }
}
