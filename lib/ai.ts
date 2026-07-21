// ============================================================
// Camada de IA genérica (headless por provider/modelo).
// As rotas chamam runAI(phase, ...) e o config resolve provider+modelo.
// Nenhuma rota referencia um provider diretamente.
// ============================================================
import type { AIProvider, PhaseKey, StepAIConfig } from "@/types";
import { AI_BY_PHASE } from "@/lib/config";

export class AIError extends Error {
  constructor(
    message: string,
    public code: "no_key" | "request_failed" | "bad_output" = "request_failed"
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

async function callAnthropic(
  model: string,
  key: string,
  { system, prompt, maxTokens = 2048 }: CallOpts
): Promise<string> {
  // `temperature` é deprecado nos modelos Claude mais novos (ex.: claude-sonnet-5),
  // que retornam 400 se ele for enviado — por isso não o incluímos aqui.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  });
  if (!res.ok) {
    throw new AIError(`Anthropic ${res.status}: ${await safeText(res)}`);
  }
  const data = await res.json();
  // Modelos com "extended thinking" (ex.: claude-sonnet-5) retornam um bloco
  // `thinking` antes do `text`. Juntamos TODOS os blocos de texto (não só o
  // primeiro) — se o thinking consumir muito do orçamento, o texto pode vir
  // fragmentado; concatenar evita perder parte do JSON.
  const blocks = (data?.content ?? []) as Array<{ type?: string; text?: string }>;
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

async function callOpenAI(
  model: string,
  key: string,
  { system, prompt, maxTokens = 2048, temperature = 0.2 }: CallOpts
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new AIError(`OpenAI ${res.status}: ${await safeText(res)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content as string) ?? "";
}

async function callGoogle(
  model: string,
  key: string,
  { system, prompt, maxTokens = 2048, temperature = 0.2 }: CallOpts
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) {
    throw new AIError(`Google ${res.status}: ${await safeText(res)}`);
  }
  const data = await res.json();
  return (
    (data?.candidates?.[0]?.content?.parts?.[0]?.text as string) ?? ""
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<sem corpo>";
  }
}

/** Chamada crua de IA usando uma config explícita de provider/modelo. */
export async function callAI(
  cfg: StepAIConfig,
  opts: CallOpts
): Promise<string> {
  const key = keyFor(cfg.provider);
  if (!key) {
    throw new AIError(
      `Sem API key para o provider "${cfg.provider}". Configure a env correspondente.`,
      "no_key"
    );
  }
  switch (cfg.provider) {
    case "anthropic":
      return callAnthropic(cfg.model, key, opts);
    case "openai":
      return callOpenAI(cfg.model, key, opts);
    case "google":
      return callGoogle(cfg.model, key, opts);
  }
}

/** Executa uma etapa resolvendo o provider/modelo pelo config headless. */
export async function runAI(phase: PhaseKey, opts: CallOpts): Promise<string> {
  return callAI(AI_BY_PHASE[phase], opts);
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
