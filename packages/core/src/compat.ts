// ============================================================
// Ponte entre o resultado do orquestrador e o formato de FASES.
//
// Existe por uma restrição dura: há análises gravadas em produção com
// `phases: { plan, skills, software, refactor }` no JSONB, e o relatório, a
// exportação e a tela de resultados leem essas linhas. Migrar o histórico para
// o formato novo seria reescrever dado de produção para ganhar nada — o que já
// está gravado não vai mudar de conteúdo.
//
// Então o painel web continua escrevendo e lendo `phases`, e é aqui que a
// tradução acontece. O terminal e a extensão NÃO passam por este arquivo: eles
// consomem `AnalysisRun` direto, que é o formato de verdade.
//
// O mapeamento revela por que o fluxo era rígido: `software` sozinha embrulhava
// TRÊS analisadores. Era essa amarração que impedia pedir só o Trivy.
// ============================================================
import type { AnalysisRun, AnalyzerOutcome, UnavailableReason } from "./contracts";
import type {
  AnalyzerId,
  DependencyVuln,
  PhaseKey,
  ScanResult,
  SkillValidation,
  StepStatus,
  ThreatModel,
  Vulnerability,
} from "./types";
import { ENGINES } from "./config";
import { translate } from "./i18n/translate";
import type { Locale } from "./i18n/config";
import type { MessageKey } from "./i18n/messages";

/** Em que fase do formato antigo cada analisador aparece. */
export function analyzerToPhase(id: AnalyzerId): PhaseKey {
  switch (id) {
    case "threat":
      return "plan";
    case "skills":
      return "skills";
    case "sast":
    case "sca":
    case "business":
      return "software";
  }
}

/** Quais analisadores compõem uma fase. É o inverso de `analyzerToPhase`. */
export function phaseAnalyzers(phase: PhaseKey): AnalyzerId[] {
  switch (phase) {
    case "plan":
      return ["threat"];
    case "skills":
      return ["skills"];
    case "software":
      return ["sast", "sca", "business"];
    case "refactor":
      // A correção não é analisador: ela sai sob demanda, por clique, e não
      // gera nada durante a análise desde o BUG-16.
      return [];
  }
}

/** Motivo de indisponibilidade -> chave de tradução. */
export function reasonKey(reason: UnavailableReason): MessageKey {
  return `analyzer.reason.${reason}` as MessageKey;
}

/**
 * Estado da fase a partir dos analisadores que a compõem.
 *
 * A regra de precedência importa: um único erro faz a fase inteira ser erro
 * (é o que a tela precisa destacar), mas "todos pulados" é `skipped` e não
 * erro — não pedir o Trivy não é falha. E a fase só é `done` quando pelo menos
 * um analisador dela realmente rodou; caso contrário a tela comemoraria
 * "nenhuma vulnerabilidade 🎉" sobre algo que ninguém analisou, que é
 * exatamente o UX-15.
 */
export function phaseStatusFrom(outcomes: AnalyzerOutcome[]): StepStatus {
  if (!outcomes.length) return "skipped";
  if (outcomes.some((o) => o.status === "error")) return "error";
  if (outcomes.some((o) => o.status === "done")) return "done";
  return "skipped";
}

/**
 * Resultado da fase `software` a partir dos três analisadores que a compõem.
 *
 * `ran: false` + `note` é o contrato que a tela já lê para distinguir "não
 * encontrou nada" de "não procurou". Cada seção é montada do desfecho do SEU
 * analisador — se só o SCA rodou, `sast.ran` é falso com o motivo, e a aba de
 * código diz que não foi executada em vez de aparecer vazia.
 */
export function scanResultFrom(
  outcomes: Record<string, AnalyzerOutcome>,
  locale: Locale
): ScanResult {
  const nota = (o: AnalyzerOutcome | undefined): string | undefined => {
    if (!o) return translate(locale, "analyzer.reason.not_selected");
    if (o.status === "error") return o.error;
    if (o.status === "skipped" && o.reason) {
      return translate(locale, reasonKey(o.reason), { bin: "" }).trim();
    }
    return undefined;
  };

  const sast = outcomes.sast;
  const sca = outcomes.sca;
  const business = outcomes.business;

  const review = business?.status === "done"
    ? (business.result as ScanResult["review"])
    : undefined;

  return {
    sast: {
      engine: ENGINES.sast,
      ran: sast?.status === "done",
      note: nota(sast),
      vulnerabilities:
        sast?.status === "done" ? (sast.result as Vulnerability[]) : [],
    },
    sca: {
      engine: ENGINES.sca,
      ran: sca?.status === "done",
      note: nota(sca),
      dependencies:
        sca?.status === "done" ? (sca.result as DependencyVuln[]) : [],
    },
    review: review ?? {
      engine: "security-review",
      ran: false,
      findings: [],
      note: nota(business),
    },
  };
}

export interface PhaseSnapshot {
  status: StepStatus;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  result?: ThreatModel | SkillValidation[] | ScanResult;
  /** Contexto que faltou, já traduzido — vai gravado e é lido do banco depois. */
  degradedNotes?: string[];
}

/** Traduz um `AnalysisRun` inteiro para o formato de fases. */
export function phasesFrom(
  run: AnalysisRun,
  locale: Locale
): Record<PhaseKey, PhaseSnapshot> {
  const snap = (phase: PhaseKey): PhaseSnapshot => {
    const ids = phaseAnalyzers(phase);
    const outs = ids.map((id) => run.outcomes[id]).filter(Boolean);
    const status = phaseStatusFrom(outs);

    const errado = outs.find((o) => o.status === "error");
    const pulado = outs.length && outs.every((o) => o.status === "skipped")
      ? outs[0]
      : undefined;

    // A degradação é gravada JÁ TRADUZIDA, no idioma de quem pediu a análise:
    // este texto é lido do banco meses depois e não passa por `t()` na
    // exibição. Mesma decisão do `phases[].error` e do `sast.note`.
    const degradedNotes = outs
      .flatMap((o) => o.degraded)
      .map((id) => translate(locale, `analyzer.degraded.${id}` as MessageKey));

    return {
      status,
      error:
        errado?.error ??
        (pulado?.reason
          ? translate(locale, reasonKey(pulado.reason), { bin: "" }).trim()
          : undefined),
      startedAt: outs.map((o) => o.startedAt).filter(Boolean).sort()[0],
      finishedAt: outs
        .map((o) => o.finishedAt)
        .filter(Boolean)
        .sort()
        .pop(),
      result:
        phase === "plan"
          ? (run.outcomes.threat?.result as ThreatModel | undefined)
          : phase === "skills"
            ? (run.outcomes.skills?.result as SkillValidation[] | undefined)
            : phase === "software"
              ? scanResultFrom(run.outcomes, locale)
              : undefined,
      degradedNotes: degradedNotes.length ? [...new Set(degradedNotes)] : undefined,
    };
  };

  return {
    plan: snap("plan"),
    skills: snap("skills"),
    software: snap("software"),
    // A correção não roda na análise (AUDITORIA.md#BUG-16): a fase existe para
    // a tela ter onde pendurar o que foi corrigido sob demanda depois.
    refactor: { status: "skipped", result: undefined },
  };
}

/**
 * Progresso = concluídas sobre SELECIONADAS.
 *
 * O denominador mudou junto com o fluxo. Com quatro fases fixas, dividir por
 * quatro era certo; agora, pedir só o Trivy e ver "25%" ao lado de "concluído"
 * seria a mesma contradição do BUG-21, só que ao contrário. O que não foi
 * pedido não entra na conta.
 */
export function progressFrom(run: AnalysisRun): number {
  const selecionados = Object.values(run.outcomes).filter(
    (o) => o.status !== "skipped"
  );
  if (!selecionados.length) return 100;
  const prontos = selecionados.filter((o) => o.status === "done").length;
  return Math.round((prontos / selecionados.length) * 100);
}
