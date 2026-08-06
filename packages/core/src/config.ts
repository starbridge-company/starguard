// ============================================================
// Configuração do MOTOR — provedor de IA, orçamento de tokens, engines e
// binários. Tudo trocável por variável de ambiente, sem tocar no código.
//
// Por que está separado do `lib/config.ts` do app: aquele arquivo também
// carrega Argon2, JWT, cookies, cota de requisição e semente do banco — coisas
// que só existem porque há um servidor web. O terminal e a extensão do VS Code
// precisam do orçamento de tokens e do caminho do Trivy; não precisam saber o
// que é um cookie de sessão. `lib/config.ts` reexporta o que está aqui, então
// nenhum importador do app mudou de endereço.
//
// Os nomes das variáveis (`STEP1_MODEL`, `SAST_ENGINE`…) foram mantidos: quem
// já tem um `.env` em produção não deveria precisar reescrevê-lo por causa de
// uma reorganização de pastas.
// ============================================================
import type { AIProvider, AnalyzerId, PhaseKey, StepAIConfig } from "./types";

const DEFAULT_PROVIDER = (process.env.AI_PROVIDER as AIProvider) || "anthropic";
const DEFAULT_MODEL = process.env.AI_MODEL || "claude-sonnet-5";

/**
 * Teto de saída por etapa, em tokens.
 *
 * Não é um controle de usuário — é ajuste nosso, por env. Os modelos com
 * "extended thinking" (claude-sonnet-5 e afins) gastam ESTE MESMO orçamento
 * raciocinando antes de escrever: uma descrição de sistema longa aumenta o
 * pensamento e o JSON acaba cortado no meio. A Fase 1 foi a que estourou na
 * prática. Ver AUDITORIA.md#BUG-13.
 */
const STEP_MAX_TOKENS: Record<1 | 2 | 3 | 4, number> = {
  1: 16000, // modelagem de ameaças: thinking + JSON com ameaças e requisitos
  2: 8000, // validação de skills
  3: 16000, // revisão por IA do repositório
  4: 16000, // correção de código (arquivo inteiro na resposta)
};

export function phaseMaxTokens(n: 1 | 2 | 3 | 4): number {
  return Number(process.env[`STEP${n}_MAX_TOKENS`] || STEP_MAX_TOKENS[n]);
}

/** Teto absoluto do retry automático — freio contra custo desgovernado. */
export const AI_MAX_OUTPUT_TOKENS = Number(
  process.env.AI_MAX_OUTPUT_TOKENS || 32000
);

function stepAI(n: 1 | 2 | 3 | 4): StepAIConfig {
  const provider =
    (process.env[`STEP${n}_PROVIDER`] as AIProvider) || DEFAULT_PROVIDER;
  const model = process.env[`STEP${n}_MODEL`] || DEFAULT_MODEL;
  return { provider, model };
}

// Etapa -> configuração de IA (fase 3 não usa IA para escanear, mas usa para
// contextualizar os achados — reaproveita STEP3 se definido, senão o default).
export const AI_BY_PHASE: Record<Exclude<PhaseKey, never>, StepAIConfig> = {
  plan: stepAI(1),
  skills: stepAI(2),
  software: stepAI(3),
  refactor: stepAI(4),
};

/**
 * De qual etapa cada analisador tira a sua configuração de IA.
 *
 * O orquestrador raciocina em analisadores; as variáveis de ambiente falam em
 * etapas numeradas. Este mapa é a ponte, e existe para que trocar o modelo do
 * analisador de regras de negócio continue sendo `STEP3_MODEL=` — o que já
 * está documentado no `.env.example` e no `.env` de quem usa.
 *
 * `sast` e `sca` não aparecem: são binários, não modelos. O enriquecimento dos
 * achados deles é feito por `enrich.ts`, que usa a etapa 3.
 */
const STEP_BY_ANALYZER: Partial<Record<AnalyzerId, 1 | 2 | 3 | 4>> = {
  threat: 1,
  skills: 2,
  business: 3,
};

/** Configuração de IA de um analisador. Cai no padrão global se não mapeado. */
export function aiFor(id: AnalyzerId): StepAIConfig {
  const step = STEP_BY_ANALYZER[id];
  return step ? stepAI(step) : { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

/** Orçamento de saída de um analisador, em tokens. */
export function maxTokensFor(id: AnalyzerId): number {
  return phaseMaxTokens(STEP_BY_ANALYZER[id] ?? 3);
}

/** Configuração de IA da CORREÇÃO (etapa 4), comum a todos os corretores. */
export function aiForFix(): StepAIConfig {
  return stepAI(4);
}

export function maxTokensForFix(): number {
  return phaseMaxTokens(4);
}

/**
 * Parâmetros HTTP das chamadas de IA. Ver AUDITORIA.md#BUG-12.
 *
 * É função, e não constante de módulo, porque estes valores são lidos dentro
 * de laços de retry — e os testes precisam zerar o backoff sem reimportar o
 * módulo inteiro.
 */
export function aiHttp(phase?: PhaseKey) {
  // Teto de tempo por chamada. Sem ele, um provedor lento segura a fase até o
  // `maxDuration` da rota e o usuário não recebe erro nenhum.
  //
  // Mas o teto GLOBAL de 120 s era curto demais para a correção: ela devolve o
  // arquivo INTEIRO, e emitir mil linhas leva minutos. A rota tem
  // `maxDuration = 300`, então abortar em 120 s desperdiçava dois terços do
  // orçamento e devolvia "tempo esgotado" numa chamada que ia terminar.
  const padrao = Number(process.env.AI_TIMEOUT_MS || 120_000);
  const porFase =
    phase === "refactor" || phase === "software"
      ? Number(process.env.AI_TIMEOUT_LONG_MS || 280_000)
      : padrao;
  return {
    timeoutMs: Math.max(padrao, porFase),
    // Tentativas ADICIONAIS após a primeira falha reentrante (429/5xx).
    maxRetries: Number(process.env.AI_MAX_RETRIES ?? 2),
    // Base do backoff exponencial; o `retry-after` do provedor tem prioridade.
    retryBaseMs: Number(process.env.AI_RETRY_BASE_MS ?? 800),
  };
}

export const ENGINES = {
  sast: (process.env.SAST_ENGINE || "opengrep").toLowerCase(),
  sca: (process.env.SCA_ENGINE || "trivy").toLowerCase(),
  dast: (process.env.DAST_ENGINE || "none").toLowerCase(),
  // Correção: "agent" (padrão) = agente autônomo (Claude Agent SDK) que lê o
  // repo e edita os arquivos; "api" = disparo único na Claude API.
  // O agente é a via principal; a API entra como fallback silencioso se falhar.
  fix: (process.env.FIX_ENGINE || "agent").toLowerCase(),
};

// Parâmetros do engine de agente (só usados quando FIX_ENGINE=agent).
export const FIX_AGENT = {
  model: process.env.FIX_AGENT_MODEL || "",
  maxTurns: Number(process.env.FIX_AGENT_MAX_TURNS || 24),
  maxBudgetUsd: Number(process.env.FIX_AGENT_BUDGET_USD || 1),
  timeoutMs: Number(process.env.FIX_AGENT_TIMEOUT_MS || 270_000),
};

// ------------------------------------------------------------
// Onde estão os executáveis.
//
// LIDO A CADA ACESSO, e não uma vez na carga do módulo. Isto não é preferência
// de estilo — era um bug, e um bug que fazia a extensão do VS Code parecer
// simplesmente quebrada.
//
// O que acontecia: `extension.ts` importa o núcleo na primeira linha, então
// este módulo é avaliado durante a ATIVAÇÃO. As configurações
// `starguard.semgrepPath` e `starguard.trivyPath` só são lidas depois, em
// `aplicarConfiguracao()`, que escreve em `process.env` — tarde demais. O
// objeto já estava montado com `"opengrep"` e `"trivy"` puros.
//
// O efeito para quem usa: o painel diz "o executável opengrep não foi
// encontrado neste computador", a pessoa aponta o caminho na configuração
// (que é exatamente a saída que a mensagem sugere), e **nada muda**. Não há
// erro, não há log: a configuração simplesmente não existia para o motor.
//
// Acontece em toda máquina onde o binário não está no PATH do processo que
// abriu o editor — que no Windows é a regra, não a exceção: quem instala em
// `C:\Users\<você>\bin` e acrescenta ao PATH de uma sessão de terminal não
// mudou o PATH que o VS Code herdou.
//
// `get` e não função para não tocar em nenhuma das dezenas de chamadas
// `BIN.trivy` espalhadas pelos analisadores — e getters em literal são
// enumeráveis, então `JSON.stringify(BIN)` continua funcionando.
// ------------------------------------------------------------
export const BIN = {
  get semgrep(): string {
    return process.env.SEMGREP_BIN || "semgrep";
  },
  get opengrep(): string {
    return process.env.OPENGREP_BIN || "opengrep";
  },
  get trivy(): string {
    return process.env.TRIVY_BIN || "trivy";
  },
};

// Ruleset do SAST (Opengrep/Semgrep). "auto" baixa regras do registro remoto
// (semgrep.dev) — exige rede + CA confiável. Aponte SAST_RULES para um diretório
// de regras local para rodar offline, sem depender de rede/SSL.
//
// Função, e não `const`, pelo MESMO motivo do `BIN` acima: quem configura isso
// depois da carga do módulo — o VS Code — não teria efeito nenhum. E aqui o
// sintoma é pior que "não encontrado": com "auto" o Opengrep tenta baixar
// regras da rede, e numa máquina sem saída ou atrás de proxy com CA própria
// ele FALHA no meio da análise, em vez de dizer que falta configuração.
export function sastConfig(): string {
  return process.env.SAST_RULES || "auto";
}

// Resumo legível para exibir no header/relatório ("como está configurado agora").
export function engineSummary() {
  return {
    sast: ENGINES.sast,
    sca: ENGINES.sca,
    dast: ENGINES.dast,
    fix: ENGINES.fix,
    ai: AI_BY_PHASE,
  };
}
