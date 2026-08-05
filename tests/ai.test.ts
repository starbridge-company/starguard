import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callAI, AIError } from "@starguard/core/ai";

// Cobre AUDITORIA.md#BUG-12 (timeout + retry), #BUG-13 (resposta truncada) e
// #BUG-14 (parâmetros que os modelos atuais da OpenAI exigem). Todos falham
// contra a versão anterior de lib/ai.ts.

interface Chamada {
  url: string;
  body: Record<string, unknown>;
  temSignal: boolean;
}

let chamadas: Chamada[] = [];

function respostaOk(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function respostaErro(status: number, retryAfter?: string): Response {
  return {
    ok: false,
    status,
    headers: { get: (h: string) => (h === "retry-after" ? retryAfter ?? null : null) },
    json: async () => ({}),
    text: async () => "erro do provedor",
  } as unknown as Response;
}

/** Encadeia respostas: a i-ésima chamada recebe a i-ésima resposta. */
function mockFetch(respostas: Response[]) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    chamadas.push({
      url,
      body: JSON.parse(String(init.body)),
      temSignal: !!init.signal,
    });
    return respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ANTHROPIC = { provider: "anthropic" as const, model: "claude-sonnet-5" };
const OPENAI = { provider: "openai" as const, model: "gpt-5" };
const GOOGLE = { provider: "google" as const, model: "gemini-2.5-pro" };
const OPTS = { system: "s", prompt: "p" };

beforeEach(() => {
  chamadas = [];
  process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
  process.env.OPENAI_API_KEY = "sk-teste";
  process.env.GOOGLE_API_KEY = "AIza-teste";
  // Sem backoff real, senão o teste de retry levaria segundos.
  process.env.AI_RETRY_BASE_MS = "0";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AI_RETRY_BASE_MS;
  delete process.env.AI_MAX_RETRIES;
});

describe("timeout e retry · BUG-12", () => {
  it("toda chamada leva um AbortSignal — nenhuma fica pendurada para sempre", async () => {
    mockFetch([respostaOk({ content: [{ type: "text", text: "ok" }] })]);
    await callAI(ANTHROPIC, OPTS);
    expect(chamadas[0].temSignal).toBe(true);
  });

  it("um 429 isolado não mata a fase: repete e devolve o resultado", async () => {
    mockFetch([
      respostaErro(429, "0"),
      respostaOk({ content: [{ type: "text", text: "recuperado" }] }),
    ]);
    await expect(callAI(ANTHROPIC, OPTS)).resolves.toBe("recuperado");
    expect(chamadas).toHaveLength(2);
  });

  it("503 também é reentrante", async () => {
    mockFetch([
      respostaErro(503),
      respostaOk({ content: [{ type: "text", text: "ok" }] }),
    ]);
    await expect(callAI(ANTHROPIC, OPTS)).resolves.toBe("ok");
  });

  it("400 NÃO é repetido — é erro nosso, repetir só gasta", async () => {
    mockFetch([respostaErro(400)]);
    await expect(callAI(ANTHROPIC, OPTS)).rejects.toThrow(/400/);
    expect(chamadas).toHaveLength(1);
  });

  it("desiste depois do teto de tentativas, sem laço infinito", async () => {
    process.env.AI_MAX_RETRIES = "2";
    mockFetch([respostaErro(429, "0")]);
    await expect(callAI(ANTHROPIC, OPTS)).rejects.toThrow(AIError);
    expect(chamadas).toHaveLength(3); // 1 original + 2 retentativas
  });

  it("cancelamento do chamador aborta na hora, sem consumir retentativa", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamadas.push({ url: "", body: {}, temSignal: true });
        throw new DOMException("Aborted", "AbortError");
      })
    );
    await expect(callAI(ANTHROPIC, { ...OPTS, signal: ctrl.signal })).rejects.toThrow();
    expect(chamadas).toHaveLength(1);
  });
});

describe("resposta truncada · BUG-13", () => {
  it("Anthropic com stop_reason=max_tokens dá erro acionável, não 'JSON inválido'", async () => {
    mockFetch([
      respostaOk({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"a":' }],
      }),
    ]);
    await expect(callAI(ANTHROPIC, OPTS)).rejects.toMatchObject({
      code: "truncated",
    });
    // A mensagem NÃO manda "aumentar o limite de saída": esse teto é
    // configuração nossa e não existe controle na tela.
    await expect(callAI(ANTHROPIC, OPTS)).rejects.toThrow(/não coube no limite/i);
    await expect(callAI(ANTHROPIC, OPTS)).rejects.not.toThrow(/aumente o limite/i);
  });

  it("tenta de novo sozinho com o DOBRO do orçamento antes de desistir", async () => {
    // O usuário não tem como aumentar o teto — quem ajusta somos nós.
    mockFetch([
      respostaOk({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }),
      respostaOk({ stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":1}' }] }),
    ]);
    await expect(callAI(ANTHROPIC, { ...OPTS, maxTokens: 4000 })).resolves.toBe(
      '{"ok":1}'
    );
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].body.max_tokens).toBe(4000);
    expect(chamadas[1].body.max_tokens).toBe(8000);
  });

  it("cresce UMA vez só — não entra em escalada de custo", async () => {
    mockFetch([
      respostaOk({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }),
    ]);
    await expect(
      callAI(ANTHROPIC, { ...OPTS, maxTokens: 4000 })
    ).rejects.toMatchObject({ code: "truncated" });
    expect(chamadas).toHaveLength(2);
  });

  it("respeita o teto absoluto: não cresce além de AI_MAX_OUTPUT_TOKENS", async () => {
    mockFetch([
      respostaOk({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }),
    ]);
    await expect(
      callAI(ANTHROPIC, { ...OPTS, maxTokens: 32000 })
    ).rejects.toMatchObject({ code: "truncated" });
    // Já estava no teto: nada de segunda chamada.
    expect(chamadas).toHaveLength(1);
  });

  it("OpenAI com finish_reason=length idem", async () => {
    mockFetch([
      respostaOk({ choices: [{ finish_reason: "length", message: { content: "{" } }] }),
    ]);
    await expect(callAI(OPENAI, OPTS)).rejects.toMatchObject({ code: "truncated" });
  });

  it("Google com finishReason=MAX_TOKENS idem", async () => {
    mockFetch([
      respostaOk({
        candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }],
      }),
    ]);
    await expect(callAI(GOOGLE, OPTS)).rejects.toMatchObject({ code: "truncated" });
  });

  it("resposta completa passa sem alarme falso", async () => {
    mockFetch([
      respostaOk({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"ok":true}' }],
      }),
    ]);
    await expect(callAI(ANTHROPIC, OPTS)).resolves.toBe('{"ok":true}');
  });
});

describe("OpenAI nos modelos atuais · BUG-14", () => {
  it("envia max_completion_tokens e NÃO max_tokens", async () => {
    mockFetch([respostaOk({ choices: [{ message: { content: "ok" } }] })]);
    await callAI(OPENAI, { ...OPTS, maxTokens: 1234 });
    expect(chamadas[0].body.max_completion_tokens).toBe(1234);
    expect(chamadas[0].body).not.toHaveProperty("max_tokens");
  });

  it("não envia temperature — modelos de raciocínio rejeitam valor fora do default", async () => {
    mockFetch([respostaOk({ choices: [{ message: { content: "ok" } }] })]);
    await callAI(OPENAI, { ...OPTS, temperature: 0.2 });
    expect(chamadas[0].body).not.toHaveProperty("temperature");
  });
});

describe("chave ausente", () => {
  it("erro com code=no_key antes de qualquer requisição", async () => {
    delete process.env.OPENAI_API_KEY;
    const fn = mockFetch([respostaOk({})]);
    await expect(callAI(OPENAI, OPTS)).rejects.toMatchObject({ code: "no_key" });
    expect(fn).not.toHaveBeenCalled();
  });
});
