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
export async function callRemoteScan(
  t: RemoteScanTransport,
  input: RemoteScanInput
): Promise<unknown> {
  const token = await t.getToken();
  if (!token) {
    throw new RemoteScanError("Sessão expirada. Entre novamente.", "unauthorized");
  }

  let res: Response;
  try {
    res = await fetch(`${t.baseUrl}/api/scan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        analyzer: input.analyzer,
        locale: input.locale,
        files: input.files,
      }),
      signal: input.signal,
    });
  } catch (e) {
    throw new RemoteScanError(
      `Não foi possível falar com o servidor: ${(e as Error).message}`,
      "unreachable"
    );
  }

  if (res.ok) {
    const j = (await res.json()) as { result?: unknown };
    return j.result ?? null;
  }

  const corpo = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
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
  throw new RemoteScanError(msg || `Falha no scan remoto (${res.status}).`, "failed");
}
