// ============================================================
// Analisador de MODELAGEM DE AMEAÇAS.
//
// É o único que não olha para código: a entrada é a descrição do sistema, e a
// saída são ameaças e requisitos de segurança. Roda sozinho — `starguard` não
// precisa de repositório nenhum para responder "o que pode dar errado neste
// sistema".
//
// Os requisitos que ele produz alimentam o analisador de regras de negócio
// quando os dois estão no mesmo plano. Quando não estão, aquele roda mesmo
// assim, só sem requisitos declarados para conferir. NODE-ONLY (usa a camada
// de IA, que fala HTTP).
// ============================================================
import { aiFor, maxTokensFor } from "../config";
import { DEFAULT_LOCALE, LOCALE_AI_NAME, type Locale } from "../i18n/config";
import { runAI, extractJSON, hasAnyAiKey } from "../ai";
import type { Analyzer } from "../contracts";
import type { ThreatModel, Threat, Requirement } from "../types";

// Os limites de QUANTIDADE e de TAMANHO não são detalhe de estilo: sem eles a
// saída cresce junto com a descrição do sistema, e uma descrição longa fazia o
// JSON estourar o teto de tokens e voltar cortado pela metade — a fase inteira
// falhava. Ver AUDITORIA.md#BUG-13.
const THREAT_MAX_THREATS = 12;
const THREAT_MAX_REQUIREMENTS = 15;

const THREAT_SYSTEM = `Você é um especialista em DevSecOps e modelagem de ameaças. Com base na descrição do sistema, identifique as principais ameaças e gere uma lista de requisitos técnicos de segurança. Considere: autenticação, autorização, criptografia, compliance (LGPD, ANS, PCI-DSS quando aplicável), ofuscação de dados sensíveis e boas práticas OWASP. Retorne JSON com os campos threats[] e requirements[].

ORÇAMENTO DE SAÍDA — respeite à risca, a resposta é lida por máquina e não pode vir cortada:
- No máximo ${THREAT_MAX_THREATS} ameaças, priorizadas pelo risco real. Prefira poucas e certeiras a muitas e genéricas.
- No máximo ${THREAT_MAX_REQUIREMENTS} requisitos, cada um em uma frase objetiva (até 200 caracteres).
- "description" de cada ameaça: até 2 frases. "summary": até 3 frases.
- Não repita a descrição do sistema na resposta e não escreva nada fora do JSON.

Formato: {"summary":"...","threats":[{"id":"T-01","category":"...","title":"...","description":"...","severity":"critical|high|medium|low"}],"requirements":[{"id":"R-01","category":"...","text":"..."}]}`;

export async function generateThreatModel(
  systemDescription: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<ThreatModel> {
  const text = await runAI("plan", {
    system: `${THREAT_SYSTEM}

Escreva TODO o texto de saída em ${LOCALE_AI_NAME[locale]}.`,
    prompt: systemDescription.slice(0, 40000),
    // O orçamento precisa caber o "thinking" (que consome max_tokens nos
    // modelos novos) MAIS o JSON. Configurável por env, sem controle na tela:
    // é ajuste de operação, não escolha de quem usa. Ver AUDITORIA.md#BUG-13.
    maxTokens: maxTokensFor("threat"),
  });
  const parsed = extractJSON<{
    summary?: string;
    threats?: Threat[];
    requirements?: Requirement[];
  }>(text);
  // Corta o excedente também aqui: o limite do prompt é uma instrução, e
  // instrução a modelo é pedido, não garantia.
  return {
    summary: parsed.summary,
    threats: (parsed.threats || []).slice(0, THREAT_MAX_THREATS),
    requirements: (parsed.requirements || []).slice(0, THREAT_MAX_REQUIREMENTS),
  };
}

/** Modelo em uso — o `doctor` e o cabeçalho do relatório mostram isto. */
export function threatEngine(): string {
  return aiFor("threat").model;
}

// ------------------------------------------------------------
// O analisador
// ------------------------------------------------------------

export const threatAnalyzer: Analyzer<ThreatModel> = {
  id: "threat",
  needs: { workspace: false, ai: true, input: ["systemDescription"] },

  async probe({ hasInput }) {
    if (!hasInput("systemDescription")) return { ok: false, reason: "no_input" };
    if (!hasAnyAiKey()) return { ok: false, reason: "no_ai_key" };
    return { ok: true, detail: aiFor("threat").model };
  },

  async run(ctx) {
    ctx.report?.(aiFor("threat").model);
    return generateThreatModel(ctx.systemDescription ?? "", ctx.locale);
  },

  // Sem corretor: o que sai daqui são ameaças e requisitos, não defeitos num
  // arquivo. Não há o que aplicar a um código.
};
