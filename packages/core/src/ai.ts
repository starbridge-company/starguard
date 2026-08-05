// ============================================================
// Camada de IA genérica (headless por provider/modelo).
// As rotas chamam runAI(phase, ...) e o config resolve provider+modelo.
// Nenhuma rota referencia um provider diretamente.
//
// Toda chamada tem teto de tempo e retry com backoff em falha reentrante
// (AUDITORIA.md#BUG-12), e toda resposta cortada por limite de tokens vira
// erro acionável em vez de "não foi possível parsear o JSON" (#BUG-13).
// ============================================================
import type { AIProvider, PhaseKey, StepAIConfig } from "./types";
import { AI_BY_PHASE, aiHttp, AI_MAX_OUTPUT_TOKENS } from "./config";
import { callRemote, getAiTransport } from "./ai-transport";

export class AIError extends Error {
  constructor(
    message: string,
    public code:
      | "no_key"
      | "request_failed"
      | "bad_output"
      | "truncated"
      | "timeout" = "request_failed"
  ) {
    super(message);
    this.name = "AIError";
  }
}

interface CallOpts {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Cancelamento externo (ex.: o "Cancelar" do lote). Somado ao timeout. */
  signal?: AbortSignal;
  /** Trava o retry automático que dobra o orçamento — usado pela própria
   *  retentativa, para não crescer sem fim. */
  noGrow?: boolean;
  /** Etapa de origem: define o teto de tempo (correção devolve arquivo
   *  inteiro e precisa de muito mais que os 120 s padrão). */
  phase?: PhaseKey;
}

function keyFor(provider: AIProvider): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "google":
      return process.env.GOOGLE_API_KEY;
  }
}

/**
 * Existe credencial de IA para ALGUM provedor?
 *
 * Consultado pelo `probe` dos analisadores que dependem de IA, antes de rodar
 * qualquer coisa. Descobrir a falta de chave só na hora da chamada gastaria um
 * clone e minutos de espera para terminar em erro — e, no seletor da tela e no
 * `starguard doctor`, a resposta precisa vir antes, não depois.
 *
 * Lido a cada chamada e não uma vez na carga do módulo: no VS Code a chave
 * entra pelo SecretStorage depois que a extensão já subiu.
 */
export function hasAnyAiKey(): boolean {
  // Com o transporte remoto, a chave está no SERVIDOR: exigir uma local aqui
  // faria os analisadores de IA aparecerem indisponíveis para justamente quem
  // fez login para não precisar de chave nenhuma.
  if (getAiTransport().kind === "remote") return true;
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

// ------------------------------------------------------------
// Transporte: timeout + retry
// ------------------------------------------------------------

/** 429 e 5xx são transitórios; 4xx restante é erro nosso e não adianta repetir. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

/** Honra o `retry-after` do provedor (segundos ou data HTTP). */
function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers?.get?.("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * `fetch` com teto de tempo e retry. Devolve a resposta OK; qualquer outra
 * coisa vira AIError com a mensagem do provedor já truncada.
 */
async function callWithRetry(
  label: string,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  phase?: PhaseKey
): Promise<Response> {
  const { timeoutMs, maxRetries, retryBaseMs } = aiHttp(phase);
  let last = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    // O cancelamento do chamador e o timeout são independentes: qualquer um
    // aborta. `AbortSignal.any` existe no Node 20+, que é o piso do Next 16.
    const composed = signal ? AbortSignal.any([timeout, signal]) : timeout;

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: composed });
    } catch (e) {
      // Cancelamento explícito do chamador não é falha do provedor: propaga.
      if (signal?.aborted) throw e;
      if (timeout.aborted) {
        last = `${label}: tempo esgotado após ${timeoutMs} ms`;
        if (attempt < maxRetries) {
          await sleep(retryBaseMs * 2 ** attempt);
          continue;
        }
        throw new AIError(last, "timeout");
      }
      // Rede oscilando: vale repetir.
      last = `${label}: ${(e as Error)?.message ?? "falha de rede"}`;
      if (attempt < maxRetries) {
        await sleep(retryBaseMs * 2 ** attempt);
        continue;
      }
      throw new AIError(last);
    }

    if (res.ok) return res;

    const body = await safeText(res);
    last = `${label} ${res.status}: ${body}`;
    if (!isRetryable(res.status) || attempt === maxRetries) {
      throw new AIError(last);
    }
    await sleep(retryAfterMs(res) ?? retryBaseMs * 2 ** attempt);
  }

  throw new AIError(last || `${label}: falha desconhecida`);
}

/**
 * Resposta cortada no meio: o JSON vem quebrado e o erro precisa dizer isso.
 *
 * A mensagem NÃO manda o usuário "aumentar o limite de saída": esse teto é
 * configuração nossa (`STEP*_MAX_TOKENS`), não existe controle na tela, e
 * mandar fazer algo impossível é pior que não explicar. O que sobra sob o
 * controle de quem usa é o tamanho do que ele escreveu.
 */
function truncated(label: string): never {
  throw new AIError(
    `${label}: a resposta do modelo não coube no limite configurado. Tente uma descrição mais objetiva; se persistir, o teto de saída desta etapa precisa ser revisto.`,
    "truncated"
  );
}

// ------------------------------------------------------------
// Providers
// ------------------------------------------------------------

async function callAnthropic(
  model: string,
  key: string,
  { system, prompt, maxTokens = 2048, signal, phase }: CallOpts
): Promise<string> {
  // `temperature` é deprecado nos modelos Claude mais novos (ex.: claude-sonnet-5),
  // que retornam 400 se ele for enviado — por isso não o incluímos aqui.
  const res = await callWithRetry(
    "Anthropic",
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    },
    signal,
    phase
  );
  // Tipado à mão, e não `any`: sem a `lib` do DOM (o núcleo roda em Node, no
  // terminal e no extension host), `res.json()` devolve `unknown` — e é bom
  // que devolva. A resposta vem de um serviço externo e o formato é contrato
  // deles, não nosso; declarar a forma que a gente LÊ é o que faz uma mudança
  // no provedor virar erro de tipo em vez de `undefined` silencioso na tela.
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
  };
  // Modelos com "extended thinking" (ex.: claude-sonnet-5) retornam um bloco
  // `thinking` antes do `text`. Juntamos TODOS os blocos de texto (não só o
  // primeiro) — se o thinking consumir muito do orçamento, o texto pode vir
  // fragmentado; concatenar evita perder parte do JSON.
  const blocks = data?.content ?? [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  if (data?.stop_reason === "max_tokens") truncated("Anthropic");
  return text;
}

async function callOpenAI(
  model: string,
  key: string,
  { system, prompt, maxTokens = 2048, signal, phase }: CallOpts
): Promise<string> {
  // `max_tokens` está deprecado no /chat/completions e os modelos de raciocínio
  // o REJEITAM com 400 — o parâmetro atual é `max_completion_tokens`. Pelo mesmo
  // motivo não enviamos `temperature`: esses modelos só aceitam o default.
  // Ver AUDITORIA.md#BUG-14.
  const res = await callWithRetry(
    "OpenAI",
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    },
    signal,
    phase
  );
  const data = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string };
    }>;
  };
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === "length") truncated("OpenAI");
  return choice?.message?.content ?? "";
}

async function callGoogle(
  model: string,
  key: string,
  { system, prompt, maxTokens = 2048, temperature = 0.2, signal, phase }: CallOpts
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await callWithRetry(
    "Google",
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    },
    signal,
    phase
  );
  const data = (await res.json()) as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") truncated("Google");
  return candidate?.content?.parts?.[0]?.text ?? "";
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<sem corpo>";
  }
}

function dispatch(
  cfg: StepAIConfig,
  key: string,
  opts: CallOpts
): Promise<string> {
  switch (cfg.provider) {
    case "anthropic":
      return callAnthropic(cfg.model, key, opts);
    case "openai":
      return callOpenAI(cfg.model, key, opts);
    case "google":
      return callGoogle(cfg.model, key, opts);
  }
}

/** Chamada crua de IA usando uma config explícita de provider/modelo. */
export async function callAI(
  cfg: StepAIConfig,
  opts: CallOpts
): Promise<string> {
  // Transporte REMOTO: a chamada vai ao servidor com o token da conta, e o
  // trecho de código sai da máquina. Nenhuma chave local é exigida — é o ponto
  // do "IA pela conta". Quem liga isso é o cliente (terminal ou extensão),
  // depois de login e consentimento; nunca acontece sozinho.
  const transporte = getAiTransport();
  if (transporte.kind === "remote") {
    return callRemote(transporte, {
      cfg,
      system: opts.system,
      prompt: opts.prompt,
      maxTokens: opts.maxTokens ?? 2048,
      purpose: opts.phase,
      signal: opts.signal,
    });
  }

  const key = keyFor(cfg.provider);
  if (!key) {
    throw new AIError(
      `Sem API key para o provider "${cfg.provider}". Configure a env correspondente.`,
      "no_key"
    );
  }

  try {
    return await dispatch(cfg, key, opts);
  } catch (e) {
    // Truncou: uma única nova tentativa com o dobro do orçamento, limitada
    // pelo teto absoluto. O ajuste é NOSSO e automático — não há controle de
    // limite de saída na tela para o usuário mexer, então repassar o problema
    // a ele seria pedir o impossível. Ver AUDITORIA.md#BUG-13.
    const truncou = e instanceof AIError && e.code === "truncated";
    const atual = opts.maxTokens ?? 2048;
    const maior = Math.min(atual * 2, AI_MAX_OUTPUT_TOKENS);
    if (!truncou || opts.noGrow || maior <= atual) throw e;

    console.warn(
      `[ai] resposta truncada em ${atual} tokens; repetindo com ${maior}`
    );
    return dispatch(cfg, key, { ...opts, maxTokens: maior, noGrow: true });
  }
}

/** Executa uma etapa resolvendo o provider/modelo pelo config headless. */
export async function runAI(phase: PhaseKey, opts: CallOpts): Promise<string> {
  return callAI(AI_BY_PHASE[phase], { ...opts, phase });
}

/** Extrai o primeiro objeto/array JSON de uma resposta de IA. */
export function extractJSON<T = unknown>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?/im, "")
    .replace(/```$/im, "")
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new AIError("Resposta sem JSON.", "bad_output");
  // Tenta do primeiro delimitador até o fim, recuando se necessário.
  const candidate = cleaned.slice(start);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const lastObj = candidate.lastIndexOf("}");
    const lastArr = candidate.lastIndexOf("]");
    const end = Math.max(lastObj, lastArr);
    if (end > 0) {
      try {
        return JSON.parse(candidate.slice(0, end + 1)) as T;
      } catch {
        /* cai no throw abaixo */
      }
    }
    throw new AIError("Não foi possível parsear o JSON da IA.", "bad_output");
  }
}
