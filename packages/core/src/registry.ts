// ============================================================
// Registro de analisadores.
//
// Uma lista, um lugar. Acrescentar um analisador novo é escrever o módulo,
// implementar `Analyzer` e citá-lo aqui — o seletor da tela, o
// `starguard list`, a árvore do VS Code e o plano de execução saem todos deste
// mapa, e nenhum deles precisa ser tocado.
//
// Só de importar este módulo já se carrega os cinco analisadores, e alguns
// deles falam com `node:child_process`. É NODE-ONLY de propósito: quem está no
// navegador quer `contracts.ts` (tipos) ou a resposta da rota `/api/analyzers`,
// não o registro em si.
// ============================================================
import type { Analyzer } from "./contracts";
import { ANALYZER_IDS, type AnalyzerId } from "./types";
import { threatAnalyzer } from "./analyzers/threat";
import { sastAnalyzer } from "./analyzers/sast";
import { scaAnalyzer } from "./analyzers/sca";
import { businessAnalyzer } from "./analyzers/business";
import { skillsAnalyzer } from "./analyzers/skills";

/**
 * A ordem aqui é a de APRESENTAÇÃO — o seletor, o `list` e o relatório seguem
 * esta sequência. Não é ordem de execução: quem decide isso é o orquestrador,
 * e ele roda em paralelo o que não depende de ninguém.
 */
const ALL: Analyzer[] = [
  threatAnalyzer,
  sastAnalyzer,
  scaAnalyzer,
  businessAnalyzer,
  skillsAnalyzer,
];

const BY_ID = new Map<AnalyzerId, Analyzer>(ALL.map((a) => [a.id, a]));

// Falha na CARGA do módulo, não em runtime: um id repetido faria um analisador
// sumir do mapa em silêncio, e o sintoma apareceria como "pedi sast e não
// rodou nada" — longe da causa.
if (BY_ID.size !== ALL.length) {
  throw new Error("Registro de analisadores com id repetido.");
}

export function allAnalyzers(): Analyzer[] {
  return ALL;
}

export function getAnalyzer(id: AnalyzerId): Analyzer | undefined {
  return BY_ID.get(id);
}

/**
 * Normaliza uma seleção vinda de fora (flag do terminal, corpo de requisição,
 * configuração do editor).
 *
 * Vazio ou ausente significa TODOS: `starguard scan` sem `--only` roda tudo
 * que der, e é o que a pessoa espera. Id desconhecido é descartado em silêncio
 * aqui — quem valida entrada de usuário e reclama é a camada de cima
 * (`lib/validation.ts` na rota, o parser de flags no terminal).
 */
export function resolveSelection(select?: readonly string[] | "all"): AnalyzerId[] {
  if (!select || select === "all" || select.length === 0) {
    return [...ANALYZER_IDS];
  }
  const pedidos = new Set(select);
  return ANALYZER_IDS.filter((id) => pedidos.has(id));
}
