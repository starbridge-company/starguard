// ============================================================
// POST /api/ai/complete — a IA pela conta.
//
// É por aqui que a extensão e o terminal chamam o modelo sem ter chave
// própria: o servidor usa a chave da Starbridge, cobra da conta de quem pediu
// e registra o consumo.
//
// **Esta rota é o ponto em que o código sai da máquina de quem programa.** É a
// decisão de privacidade mais pesada do produto, e por isso está concentrada
// num arquivo só, com a regra escrita: o prompt é usado e descartado. O que
// fica gravado é metadado — quem, para quê, qual modelo, quantos tokens,
// quanto custou. Nunca o conteúdo.
//
// Ordem das defesas, e cada uma tem razão de estar onde está:
//
//  1. autenticação (Bearer) — sem conta não há a quem cobrar;
//  2. cota do mês — ANTES de falar com o modelo, senão a última chamada
//     estoura o teto;
//  3. limite de tamanho — um prompt de 10 MB é engano ou abuso, e custa caro
//     nos dois casos;
//  4. só então a chamada, e o registro do que ela consumiu.
// ============================================================
import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession } from "@/lib/http";
import { validate, aiCompleteSchema } from "@/lib/validation";
import { checarCota, registrarUso } from "@/lib/ai-quota";
import { audit, hashIp } from "@/lib/auth";
import { clientIp } from "@/lib/ratelimit";
import { redactError } from "@starguard/core/redact";
import { log } from "@starguard/core/logger";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// A correção devolve o arquivo INTEIRO e pode levar minutos — a mesma folga do
// scan. Sem isto, a rota morre antes do modelo responder.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.", "err.unauthenticated");

  // Sem CSRF de propósito: esta rota só aceita credencial de header (Bearer),
  // e `requireCsrf` já dispensaria. Ver a regra em `lib/http.ts` — CSRF é
  // problema de cookie, e cookie não chega aqui.

  const v = validate(aiCompleteSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message, null);
  const d = v.data;

  // A cota é checada ANTES da chamada. Depois seria tarde: a chamada que
  // estourasse o teto já teria sido paga.
  const cota = await checarCota(session.sub);
  if (!cota.ok) {
    const res = NextResponse.json(
      {
        error: "quota_exceeded",
        message: `Cota de IA do mês esgotada (US$ ${cota.uso.budgetUsd}). Renova em ${cota.resetsAt.slice(0, 10)}.`,
        resetsAt: cota.resetsAt,
        usage: cota.uso,
      },
      // 402 e não 429: não é "vá mais devagar", é "acabou até o mês virar".
      // Repetir não resolve, e o cliente precisa saber disso para não insistir.
      { status: 402 }
    );
    res.headers.set("Cache-Control", "no-store");
    audit("ai.quota.exceeded", { month: cota.uso.month }, session.sub);
    return res;
  }

  try {
    const { text, usage } = await chamarModelo(d);

    // Registrado DEPOIS da resposta, com os números que o provedor devolveu —
    // estimar tokens por contagem de caracteres daria um relatório de cobrança
    // que não bate com a fatura real.
    await registrarUso({
      userId: session.sub,
      purpose: d.purpose,
      provider: d.provider,
      model: d.model,
      inputTokens: usage.input,
      outputTokens: usage.output,
      repo: d.repo,
    });

    return jsonOk({ text, usage });
  } catch (e) {
    // Redigido: o erro do provedor pode carregar a NOSSA chave, e este texto
    // vai para a máquina de quem chamou. Ver AUDITORIA.md#SEC-01.
    const msg = redactError(e);
    log.error("ai.proxy.failed", { userId: session.sub, error: e });
    audit("ai.call.failed", { purpose: d.purpose }, session.sub, hashIp(clientIp(req.headers)));
    return jsonError(502, msg.slice(0, 300), null);
  }
}

interface Resposta {
  text: string;
  usage: { input: number; output: number };
}

/**
 * Chama o provedor com a chave DO SERVIDOR.
 *
 * Não reusa `callAI` do núcleo de propósito: aquele resolve provider e modelo
 * pela configuração local e devolve só o texto. Aqui os dois vêm do cliente
 * (dentro de uma allowlist) e o que interessa além do texto é a CONTAGEM de
 * tokens — sem ela não há cobrança nem cota.
 */
async function chamarModelo(d: {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
}): Promise<Resposta> {
  if (d.provider !== "anthropic") {
    // Um provedor só, por enquanto: cada um tem formato de resposta e de
    // contagem diferente, e cobrar errado é pior que não suportar.
    throw new Error(`Provedor não suportado pelo servidor: ${d.provider}`);
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Servidor sem chave de IA configurada.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: d.model,
      max_tokens: d.maxTokens,
      system: d.system,
      messages: [{ role: "user", content: d.prompt }],
    }),
    signal: AbortSignal.timeout(280_000),
  });

  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${corpo.slice(0, 300)}`);
  }

  const j = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  // Junta TODOS os blocos de texto: com "extended thinking" a resposta pode vir
  // fragmentada, e pegar só o primeiro perderia parte do JSON. Mesma correção
  // do BUG-13, aqui também.
  const text = (j.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

  return {
    text,
    usage: {
      input: j.usage?.input_tokens ?? 0,
      output: j.usage?.output_tokens ?? 0,
    },
  };
}
