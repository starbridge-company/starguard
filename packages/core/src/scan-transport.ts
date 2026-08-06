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
 * resolvido, não contornado; `too_large` continuaria grande localmente. Cair
 * para o local nesses casos esconderia o que a pessoa precisa consertar.
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
  return e instanceof RemoteScanError && (e.code === "unreachable" || e.code === "unavailable");
}

export type RemoteScanErrorCode =
  | "unauthorized"
  | "too_large"
  | "unavailable"
  | "unreachable"
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

/**
 * Quanto esperar antes de desistir de UMA tentativa.
 *
 * O servidor do MVP hiberna quando fica ocioso, e a primeira requisição depois
 * disso paga o tempo de subir a instância — medido acima de 45 s nesta
 * infraestrutura. Sem teto explícito o `fetch` do Node espera 300 s, e a
 * extensão fica parada sem dizer nada; com um teto curto demais, toda primeira
 * análise do dia falha. Daí o par: teto generoso e UMA segunda tentativa, que
 * já encontra a instância acordada pela primeira.
 */
const TETO_MS = 90_000;

export async function callRemoteScan(
  t: RemoteScanTransport,
  input: RemoteScanInput
): Promise<unknown> {
  const token = await t.getToken();
  if (!token) {
    throw new RemoteScanError("Sessão expirada. Entre novamente.", "unauthorized");
  }

  const payload = JSON.stringify({
    analyzer: input.analyzer,
    locale: input.locale,
    files: input.files,
  });

  const tentar = async (): Promise<Response> => {
    // Dois motivos para abortar: o teto de tempo e o cancelamento de quem
    // clicou. Um controlador só, alimentado pelos dois.
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), TETO_MS);
    const repassar = () => ctrl.abort();
    input.signal?.addEventListener("abort", repassar);
    try {
      return await fetch(`${t.baseUrl}/api/scan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: payload,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(relogio);
      input.signal?.removeEventListener("abort", repassar);
    }
  };

  let res: Response;
  try {
    res = await tentar();
  } catch {
    // Cancelamento de quem clicou NÃO é falha de rede e não se tenta de novo.
    if (input.signal?.aborted) {
      throw new RemoteScanError("Análise cancelada.", "unreachable");
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

  if (res.ok) {
    const j = (await res.json()) as { result?: unknown };
    return j.result ?? null;
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
  // Recusa que NÃO é nossa é "não cheguei lá", não "fui recusado".
  //
  // Toda resposta do StarGuard é JSON com `error`. Sem isso, quem respondeu foi
  // outra coisa no caminho — e o pedido nunca chegou ao app. Tratar como
  // `unreachable` é o que autoriza o socorro local: com o `opengrep` instalado
  // a um palmo, deixar de analisar por causa de um 403 de CDN é o pior desfecho
  // possível. A troca continua sendo DECLARADA na tela, com o motivo junto.
  //
  // Um 403 NOSSO (com corpo JSON) continua sendo `failed` e sobe: aí é
  // permissão de verdade, e contornar esconderia o que precisa ser resolvido.
  throw new RemoteScanError(
    msg || `Falha no scan remoto (${res.status}). ${pistaDaResposta(res, bruto)}`,
    msg ? "failed" : "unreachable"
  );
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
