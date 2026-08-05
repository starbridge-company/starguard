// ============================================================
// De onde vem a IA: da chave local, ou da conta no servidor.
//
// Dois transportes, uma decisão explícita:
//
//   "local"  — a chave está nesta máquina (`ANTHROPIC_API_KEY`). O código não
//              sai daqui; quem paga é quem configurou a chave. É o padrão, e
//              continua sendo o que acontece se ninguém fizer login.
//
//   "remote" — a chamada vai ao servidor do StarGuard com o token da conta, e
//              de lá ao modelo. **O trecho de código sai da máquina.** Em
//              troca, ninguém precisa de chave própria, o gasto é da conta e
//              fica registrado.
//
// A escolha NÃO é automática por conveniência. Sair da máquina é uma decisão
// que a pessoa toma sabendo — no VS Code há um consentimento explícito, no
// terminal é preciso ter feito login. Ligar o remoto sozinho porque "há um
// token disponível" seria decidir por ela algo que ela talvez não quisesse.
//
// O que o servidor GUARDA está fixado do outro lado: metadado (quem, qual
// repositório, quantos tokens, quanto custou), nunca o código.
// ============================================================
import type { StepAIConfig } from "./types";

export interface RemoteTransport {
  kind: "remote";
  /** Base do servidor do StarGuard. */
  baseUrl: string;
  /**
   * Access token da conta. É função, e não string, porque o token dura 15 min
   * e uma análise longa pode atravessar a expiração — quem chama renova.
   */
  getToken: () => Promise<string | null>;
}

export interface LocalTransport {
  kind: "local";
}

export type AiTransport = LocalTransport | RemoteTransport;

// Módulo-estado de propósito: o transporte é uma decisão do PROCESSO (este
// terminal, este extension host), não de cada chamada. Passá-lo por parâmetro
// obrigaria a atravessá-lo por todo o motor até o último analisador.
let atual: AiTransport = { kind: "local" };

export function setAiTransport(t: AiTransport): void {
  atual = t;
}

export function getAiTransport(): AiTransport {
  return atual;
}

export function usingRemoteAi(): boolean {
  return atual.kind === "remote";
}

/** Erro do proxy que o cliente precisa distinguir para agir. */
export type RemoteAiErrorCode =
  /** Sessão expirada ou revogada — refazer login. */
  | "unauthorized"
  /** Cota do mês esgotada — não adianta repetir. */
  | "quota_exceeded"
  /** O servidor não está de pé, ou a rede caiu. */
  | "unreachable"
  | "failed";

export class RemoteAiError extends Error {
  constructor(
    message: string,
    public code: RemoteAiErrorCode,
    /** Quando a cota renova, quando o servidor informa. */
    public resetsAt?: string
  ) {
    super(message);
    this.name = "RemoteAiError";
  }
}

export interface RemoteCallInput {
  cfg: StepAIConfig;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Só para o servidor atribuir o gasto — não é conteúdo. */
  purpose?: string;
  signal?: AbortSignal;
}

/**
 * Chama o modelo através do servidor.
 *
 * O corpo leva o prompt (é o que precisa ser analisado) e NADA de identidade
 * de máquina: quem é a pessoa vem do token, e o resto o servidor não precisa
 * saber.
 */
export async function callRemote(
  t: RemoteTransport,
  input: RemoteCallInput
): Promise<string> {
  const token = await t.getToken();
  if (!token) {
    throw new RemoteAiError("Sessão expirada. Entre novamente.", "unauthorized");
  }

  let res: Response;
  try {
    res = await fetch(`${t.baseUrl}/api/ai/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        provider: input.cfg.provider,
        model: input.cfg.model,
        system: input.system,
        prompt: input.prompt,
        maxTokens: input.maxTokens,
        purpose: input.purpose,
      }),
      signal: input.signal,
    });
  } catch (e) {
    // Servidor fora do ar é diferente de cota estourada: um pede para tentar
    // depois, o outro não adianta repetir. Confundi-los faria o cliente
    // insistir contra uma parede.
    throw new RemoteAiError(
      `Não foi possível falar com o servidor: ${(e as Error).message}`,
      "unreachable"
    );
  }

  if (res.ok) {
    const j = (await res.json()) as { text?: string };
    return j.text ?? "";
  }

  const corpo = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    resetsAt?: string;
  };

  if (res.status === 401) {
    throw new RemoteAiError(
      corpo.message || "Sessão expirada. Entre novamente.",
      "unauthorized"
    );
  }
  if (res.status === 402 || res.status === 429) {
    throw new RemoteAiError(
      corpo.message || "Cota de IA da conta esgotada.",
      "quota_exceeded",
      corpo.resetsAt
    );
  }
  throw new RemoteAiError(
    corpo.message || `Falha no servidor de IA (${res.status}).`,
    "failed"
  );
}
