// ============================================================
// Enriquecimento das descrições de achados.
//
// O texto que vem do scanner é seco, técnico e em INGLÊS ("An action sourced
// from a third-party repository on GitHub is not pinned…"), e a "sugestão" do
// SAST é uma frase fixa igual para todos os achados. Quem lê não sabe o que é,
// por que importa nem o que fazer. Ver AUDITORIA.md#FEAT-03.
//
// Estratégia de custo, em ordem:
//   1. catálogo local  -> instantâneo, sem custo, funciona offline;
//   2. IA em LOTE      -> uma única chamada para TODAS as regras desconhecidas
//                         (um repositório com 44 achados costuma ter ~10 regras
//                         distintas — por achado seriam 44 chamadas);
//   3. nada            -> mantém o texto original, MARCADO como texto da
//                         ferramenta, em inglês. Nunca inventamos tradução.
// ============================================================
import "server-only";
import { runAI, extractJSON } from "@/lib/ai";
import { lookupCatalog } from "@/lib/catalog";
import { DEFAULT_LOCALE, LOCALE_AI_NAME, type Locale } from "@/lib/i18n/config";
import type { FindingExplain, Vulnerability } from "@/types";

/** Teto de regras distintas enviadas à IA numa passada. */
const MAX_RULES_PER_CALL = 25;

const systemFor = (locale: Locale) => `Você explica achados de ferramentas de segurança para desenvolvedores. Para CADA regra recebida, escreva EM ${LOCALE_AI_NAME[locale].toUpperCase()}, de forma direta e específica:
- "title": rótulo curto (no máximo 6 palavras) que nomeia o problema. É o título que aparece na tela.
- "whatItIs": o que o problema é, em UMA frase.
- "whyItMatters": por que é perigoso na prática — o impacto concreto, não a teoria.
- "attackScenario": como um atacante exploraria, em uma frase. Omita se a regra for de qualidade de código e não de segurança.
- "howToFix": o que fazer, acionável, citando a construção correta da linguagem.

Regras da resposta:
- NÃO repita o texto original em inglês; explique com suas palavras.
- NADA de generalidades ("siga as boas práticas"). Se não souber o que a regra faz, diga o que o nome dela indica e mantenha a orientação conservadora.
- Sem markdown, sem listas, sem emojis. Frases completas.

Responda APENAS com JSON: {"<id da regra>": {"whatItIs":"...","whyItMatters":"...","attackScenario":"...","howToFix":"..."}}`;

interface RuleGroup {
  key: string;
  ruleId: string;
  cwe?: string;
  owasp?: string;
  sample: string; // título/descrição original, como pista para a IA
}

function ruleKeyOf(v: Vulnerability): string {
  return `${v.ruleId || "sem-regra"}|${v.cwe || ""}`;
}

/**
 * Enriquece os achados. NUNCA lança: qualquer falha deixa o texto original
 * (marcado como `source: "scanner"`) — um scan não pode quebrar porque a
 * explicação falhou.
 */
export async function enrichFindings(
  findings: Vulnerability[],
  locale: Locale = DEFAULT_LOCALE
): Promise<Vulnerability[]> {
  if (!findings.length) return findings;

  // 1) Catálogo, achado a achado.
  const pending = new Map<string, RuleGroup>();
  const resolved = new Map<string, FindingExplain>();

  for (const f of findings) {
    const key = ruleKeyOf(f);
    if (resolved.has(key) || pending.has(key)) continue;

    const hit = lookupCatalog(f.ruleId, f.cwe, locale);
    if (hit) {
      resolved.set(key, hit);
      continue;
    }
    pending.set(key, {
      key,
      ruleId: f.ruleId || "sem-regra",
      cwe: f.cwe,
      owasp: f.owasp,
      sample: (f.description || f.title || "").slice(0, 300),
    });
  }

  // 2) IA, uma chamada para todas as regras que sobraram.
  const groups = [...pending.values()].slice(0, MAX_RULES_PER_CALL);
  if (groups.length) {
    try {
      const prompt = groups
        .map(
          (g, i) =>
            `${i + 1}. id: ${g.key}\n   regra: ${g.ruleId}${
              g.cwe ? `\n   CWE: ${g.cwe}` : ""
            }${g.owasp ? `\n   OWASP: ${g.owasp}` : ""}\n   texto original da ferramenta: ${g.sample}`
        )
        .join("\n\n");

      const text = await runAI("software", {
        system: systemFor(locale),
        prompt: `Explique cada uma das ${groups.length} regras abaixo. Use exatamente o "id" como chave no JSON de resposta.\n\n${prompt}`,
        maxTokens: 8000,
      });

      const parsed = extractJSON<Record<string, Partial<FindingExplain>>>(text);
      for (const g of groups) {
        const e = parsed[g.key] || parsed[g.ruleId];
        if (!e?.whatItIs || !e?.howToFix) continue;
        resolved.set(g.key, {
          title: e.title ? String(e.title).slice(0, 80) : undefined,
          whatItIs: String(e.whatItIs).slice(0, 400),
          whyItMatters: String(e.whyItMatters || "").slice(0, 600),
          attackScenario: e.attackScenario
            ? String(e.attackScenario).slice(0, 500)
            : undefined,
          howToFix: String(e.howToFix).slice(0, 600),
          source: "ai",
        });
      }
    } catch (err) {
      // Sem chave, sem rede ou JSON inválido: seguimos com o catálogo e o
      // texto original. O scan não pode falhar por causa disto.
      console.warn(
        "[enrich] explicação por IA indisponível:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // 3) Aplica; o que não foi resolvido fica marcado como texto da ferramenta.
  return findings.map((f) => {
    const hit = resolved.get(ruleKeyOf(f));
    if (hit) return { ...f, explain: hit };
    return {
      ...f,
      explain: {
        whatItIs: f.title,
        whyItMatters: f.description || "",
        howToFix: f.suggestion || "",
        source: "scanner" as const,
      },
    };
  });
}
