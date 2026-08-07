// ============================================================
// Contratos do motor. Este arquivo é o que define, na prática, o que
// "analisador independente" quer dizer.
//
// A regra: um analisador só conhece o `AnalyzerContext` que recebe. Ele não
// sabe quem o chamou, não sabe quem mais está rodando, não escreve no banco,
// não imprime na tela e não decide se deve rodar. Quem decide é o
// orquestrador; quem mostra são os sinks. É essa separação que faz o mesmo
// código servir o painel web, o terminal e a extensão do VS Code.
//
// Módulo só de tipos + constantes puras: pode ser importado de qualquer lugar,
// inclusive do navegador.
// ============================================================
import type {
  AnalyzerId,
  DependencyVuln,
  Requirement,
  Severity,
  Vulnerability,
} from "./types";
import type { Locale } from "./i18n/config";
import type { MessageKey } from "./i18n/messages";

// ------------------------------------------------------------
// Workspace — de onde sai o código
// ------------------------------------------------------------

/**
 * A origem do código a analisar.
 *
 * `git` é o caminho do painel web: clona um descartável e apaga no fim.
 * `local` é o do terminal e o da extensão: o código já está no disco de quem
 * pediu, e copiá-lo para outro lugar seria lento e analisaria uma versão que
 * não é a que a pessoa está editando.
 * `none` existe porque nem todo analisador precisa de código — a modelagem de
 * ameaças trabalha sobre a descrição do sistema, e a validação de skills sobre
 * o texto das skills.
 */
export type WorkspaceSource =
  | { type: "git"; url: string; token?: string }
  | { type: "local"; path: string }
  | { type: "none" };

export interface Workspace {
  kind: "git" | "local";
  /** Raiz em disco. Todo caminho de achado é relativo a ela. */
  root: string;
  /** Preenchido só quando veio de um remoto — é o que permite abrir PR. */
  origin?: { url: string; owner: string; repo: string };
  /**
   * Lê um arquivo do workspace. `rel` vem de relatório de scanner, ou seja, de
   * fora: a implementação CONFINA a leitura à raiz e devolve `null` para
   * qualquer coisa que escape dela. Ver `workspace.test.ts`.
   */
  readFile(rel: string): Promise<string | null>;
  /** Grava um arquivo. Só `apply()` chama isto — `propose()` nunca escreve. */
  writeFile(rel: string, content: string): Promise<void>;
  /** Descarta o que for descartável (o clone temporário). Idempotente. */
  dispose(): Promise<void>;
}

// ------------------------------------------------------------
// Disponibilidade — por que um analisador pode não rodar
// ------------------------------------------------------------

/**
 * Motivos pelos quais um analisador fica de fora. São chaves, não frases: o
 * mesmo motivo aparece no cartão desabilitado da tela, na coluna do
 * `starguard doctor` e no tooltip da árvore do VS Code, cada um no idioma de
 * quem está lendo.
 */
export type UnavailableReason =
  | "not_selected" // não foi escolhido nesta execução
  | "no_workspace" // precisa de código e ninguém informou repositório/caminho
  | "no_input" // precisa de entrada própria (descrição, skills) e não veio
  | "binary_missing" // o executável configurado não está no host
  // O executável ESTÁ no disco e este processo não consegue mais iniciá-lo.
  // Motivo próprio porque a saída é outra: não há nada a instalar, há um
  // servidor a reiniciar. Medido: um `next dev` com uma hora de vida passou a
  // devolver 0xC0000142 em TODO processo filho, enquanto um servidor recém
  // subido na mesma máquina executava os mesmos binários sem hesitar. Dizer
  // "não foi encontrado neste computador" ali é uma afirmação falsa sobre a
  // máquina de quem lê. Ver `binaries.ts`.
  | "spawn_failed"
  // O binário existe, mas não há RULESET para ele. Motivo próprio porque a
  // resposta é outra: não é "instale o opengrep", é "aponte as regras". Com
  // opengrep, `--config auto` não funciona (exit 2, saída vazia), então rodar
  // assim mesmo seria gastar 27 s para terminar sem explicação — o oposto do
  // que "indisponível aparece COM o motivo" promete. Ver AUDITORIA.md#ARQ-18.
  | "no_rules"
  | "engine_off" // desligado por configuração (SAST_ENGINE=none)
  | "no_ai_key" // precisa de IA e não há credencial
  // Cancelado antes de começar. É motivo como os outros, e não ausência: quem
  // cancelou precisa ver QUEM não chegou a rodar — senão o resultado parcial
  // passa por completo, que é o mesmo erro do UX-15 com outra roupa.
  | "cancelled";

export interface Availability {
  ok: boolean;
  reason?: UnavailableReason;
  /** Versão do binário/modelo, quando dá para saber. Ajuda no `doctor`. */
  detail?: string;
}

// ------------------------------------------------------------
// O analisador
// ------------------------------------------------------------

/** Que tipo de entrada própria o analisador consome, além do código. */
export type InputKind = "systemDescription" | "skills";

export interface AnalyzerNeeds {
  /** Precisa de código em disco para trabalhar. */
  workspace: boolean;
  /** Precisa de credencial de IA. */
  ai: boolean;
  /** Chave em `BIN` do executável exigido, quando houver. */
  binary?: "semgrep" | "opengrep" | "trivy";
  /** Entradas próprias, sem as quais não há o que analisar. */
  input?: InputKind[];
}

export interface AnalyzerContext {
  /** `undefined` quando o analisador não precisa de código. */
  workspace?: Workspace;
  locale: Locale;
  /** Cancelamento vindo de fora (Ctrl-C no terminal, botão na tela). */
  signal?: AbortSignal;
  /** Descrição do sistema, quando informada. */
  systemDescription?: string;
  /** Skills a validar, quando informadas. */
  skills?: { name: string; content: string }[];
  /**
   * Resultado dos analisadores declarados em `uses` que ESTAVAM no plano.
   * Vem incompleto de propósito quando o outro não foi selecionado — é o que
   * permite rodar "só regras de negócio" sem arrastar o SAST junto.
   */
  upstream: UpstreamResults;
  /** Progresso dentro do analisador, para a barra não ficar parada. */
  report?: (message: string, pct?: number) => void;
}

export interface UpstreamResults {
  requirements?: Requirement[];
  sastFindings?: Vulnerability[];
  scaFindings?: DependencyVuln[];
}

export interface Analyzer<R = unknown> {
  id: AnalyzerId;
  needs: AnalyzerNeeds;
  /**
   * Analisadores cujo resultado ENRIQUECE este.
   *
   * Não é dependência de execução: se o outro não estiver no plano, este roda
   * mesmo assim, com menos contexto, e o orquestrador registra a degradação.
   * Tratar isto como pré-requisito rígido devolveria o pipeline linear pela
   * porta dos fundos.
   */
  uses?: AnalyzerId[];
  /** O ambiente permite rodar? Não lança: indisponível é resposta, não erro. */
  probe(ctx: { hasWorkspace: boolean; hasInput: (k: InputKind) => boolean }): Promise<Availability>;
  run(ctx: AnalyzerContext): Promise<R>;
  /** A correção mora DENTRO da ferramenta que achou o problema. */
  fix?: Fixer;
}

// ------------------------------------------------------------
// Correção
// ------------------------------------------------------------

/** O mínimo que um corretor precisa saber sobre o achado. */
export interface FixableFinding {
  id: string;
  analyzer: AnalyzerId;
  ruleId?: string;
  title: string;
  severity: Severity;
  file: string;
  line?: number;
  endLine?: number;
  description: string;
  suggestion?: string;
  codeSnippet?: string;
  cwe?: string;
  owasp?: string;
  /** Payload original do analisador — o corretor dele sabe o que é. */
  raw?: unknown;
}

export interface FixContext {
  workspace?: Workspace;
  locale: Locale;
  /** Instruções livres de quem está revisando. */
  userInstructions?: string;
  /** Origem remota, quando a correção deve buscar o arquivo pela API. */
  repoUrl?: string;
  token?: string;
  /** Outros achados do MESMO arquivo, para corrigir tudo numa passada. */
  alsoFix?: FixableFinding[];
  /** Ponto de partida numa correção em fatias. */
  baseCode?: string;
  signal?: AbortSignal;
}

/** Uma alteração proposta a um arquivo. Nada disto foi gravado ainda. */
export interface FileChange {
  file: string;
  originalCode: string;
  fixedCode: string;
}

export interface FixProposal {
  findingId: string;
  /** Arquivo principal — é o que a tela e o editor mostram primeiro. */
  file: string;
  language?: string;
  changes: FileChange[];
  explanation: string;
  /** Como foi gerada: agente autônomo, chamada única de IA, ou regra nossa. */
  engine: "agent" | "api" | "deterministic";
  /** A proposta não altera nada — a tela avisa e NÃO oferece PR. */
  noChange: boolean;
  /**
   * Passos que a ferramenta NÃO executa e alguém precisa rodar (`npm install`
   * depois de mexer no manifesto, por exemplo). Sai como aviso, não silêncio.
   */
  followUp?: { commandKey: MessageKey; command?: string }[];
}

export type FixEligibility =
  | { ok: true }
  | { ok: false; reasonKey: MessageKey };

export interface Fixer {
  /** Dá para propor correção deste achado? O motivo é exibível. */
  can(finding: FixableFinding): FixEligibility;
  /** Gera a correção. NUNCA escreve em disco. */
  propose(finding: FixableFinding, ctx: FixContext): Promise<FixProposal>;
  /** Grava a proposta no workspace. Só quem pediu explicitamente chega aqui. */
  apply(proposal: FixProposal, ws: Workspace): Promise<void>;
}

// ------------------------------------------------------------
// Execução — plano, eventos e sinks
// ------------------------------------------------------------

export interface PlanEntry {
  id: AnalyzerId;
  /** `true` = vai rodar. `false` = fica de fora, e `reason` diz por quê. */
  willRun: boolean;
  reason?: UnavailableReason;
  detail?: string;
  /** Analisadores de `uses` que NÃO estão neste plano. */
  missingUpstream: AnalyzerId[];
}

export interface ExecutionPlan {
  entries: PlanEntry[];
  source: WorkspaceSource;
  locale: Locale;
  /** Quantos analisadores rodam ao mesmo tempo. */
  concurrency: number;
}

export type RunEvent =
  | { type: "run:start"; plan: ExecutionPlan; at: number }
  | { type: "analyzer:start"; id: AnalyzerId; at: number }
  | { type: "analyzer:progress"; id: AnalyzerId; message: string; pct?: number }
  | {
      type: "analyzer:done";
      id: AnalyzerId;
      at: number;
      durationMs: number;
      result: unknown;
      /** Contexto que faltou; o relatório precisa dizer isto em voz alta. */
      degraded: AnalyzerId[];
    }
  | { type: "analyzer:error"; id: AnalyzerId; at: number; durationMs: number; error: string }
  | { type: "analyzer:skipped"; id: AnalyzerId; reason: UnavailableReason }
  | { type: "run:done"; at: number; durationMs: number; ok: boolean };

/**
 * Consumidor de eventos.
 *
 * É por aqui que o mesmo motor serve três interfaces: o Postgres do painel, o
 * desenho vivo do terminal, os diagnósticos do VS Code e os arquivos
 * SARIF/JSON são todos sinks. Um sink que lança não derruba a execução — ele é
 * observador, não participante.
 */
export interface Sink {
  on(event: RunEvent): void | Promise<void>;
}

export interface AnalyzerOutcome {
  id: AnalyzerId;
  status: "done" | "error" | "skipped";
  result?: unknown;
  error?: string;
  reason?: UnavailableReason;
  degraded: AnalyzerId[];
  startedAt?: number;
  finishedAt?: number;
}

export interface AnalysisRun {
  plan: ExecutionPlan;
  outcomes: Record<string, AnalyzerOutcome>;
  startedAt: number;
  finishedAt: number;
  /** `false` se algum analisador selecionado terminou em erro. */
  ok: boolean;
}
