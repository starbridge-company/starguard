// ============================================================
// Os sinks do terminal.
//
// O orquestrador emite eventos; aqui eles viram desenho. É exatamente o mesmo
// motor que alimenta o Postgres do painel e os diagnósticos do VS Code — o que
// muda é só quem escuta. Nada neste arquivo sabe analisar coisa nenhuma.
// ============================================================
import type {
  AnalysisRun,
  ExecutionPlan,
  RunEvent,
  Sink,
  UnavailableReason,
} from "@starguard/core/contracts";
import type {
  AnalyzerId,
  DependencyVuln,
  SkillValidation,
  Vulnerability,
} from "@starguard/core/types";
import { translate } from "@starguard/core/i18n/translate";
import type { Locale } from "@starguard/core/i18n/config";
import type { MessageKey } from "@starguard/core/i18n/messages";
import { reasonKey } from "@starguard/core/compat";
import {
  BlocoVivo,
  c,
  esconderCursor,
  isInteractive,
  mostrarCursor,
  spinner,
  tabela,
} from "./tty.js";

type Estado = "aguardando" | "rodando" | "pronto" | "erro" | "pulado";

interface Linha {
  id: AnalyzerId;
  estado: Estado;
  detalhe: string;
  motivo?: UnavailableReason;
  duracaoMs?: number;
  achados?: number;
  degradado: AnalyzerId[];
}

const MARCA: Record<Estado, string> = {
  aguardando: c.gray("○"),
  rodando: "",
  pronto: c.green("✔"),
  erro: c.red("✖"),
  pulado: c.gray("–"),
};

/** Quantos achados o resultado de cada analisador tem — para a linha do resumo. */
function contar(id: AnalyzerId, resultado: unknown): number | undefined {
  if (!resultado) return undefined;
  if (id === "sast") return (resultado as Vulnerability[]).length;
  if (id === "sca") return (resultado as DependencyVuln[]).length;
  if (id === "business") {
    return (resultado as { findings?: unknown[] }).findings?.length ?? 0;
  }
  if (id === "skills") {
    return (resultado as { findings: unknown[] }[]).reduce(
      (a, s) => a + s.findings.length,
      0
    );
  }
  if (id === "threat") {
    return (resultado as { threats?: unknown[] }).threats?.length ?? 0;
  }
  return undefined;
}

/**
 * Lista viva dos analisadores.
 *
 * Sem TTY vira uma linha por transição, sem redesenho — é o que se quer ler no
 * histórico de um CI. Ver `BlocoVivo`.
 */
export function ttySink(locale: Locale, projeto: string): Sink {
  const linhas = new Map<AnalyzerId, Linha>();
  const bloco = new BlocoVivo();
  let tick = 0;
  let timer: NodeJS.Timeout | undefined;

  const t = (k: MessageKey, v?: Record<string, string | number>) =>
    translate(locale, k, v);

  const desenha = () => {
    const finais: string[] = [];
    const corpo = [...linhas.values()].map((l) => {
      const marca = l.estado === "rodando" ? c.cyan(spinner(tick)) : MARCA[l.estado];
      const nome = t(`analyzer.${l.id}.name` as MessageKey);

      let direita = "";
      if (l.estado === "pronto") {
        const n = l.achados;
        direita =
          (n === undefined ? "" : n === 0 ? c.green(t("cli.clean")) : c.yellow(String(n))) +
          (l.duracaoMs ? c.gray(`  ${(l.duracaoMs / 1000).toFixed(1)}s`) : "");
      } else if (l.estado === "erro") {
        direita = c.red(l.detalhe);
      } else if (l.estado === "pulado" && l.motivo) {
        direita = c.gray(t(reasonKey(l.motivo), { bin: l.detalhe }));
      } else if (l.estado === "rodando") {
        direita = c.gray(l.detalhe);
      }

      const linha = `  ${marca} ${nome.padEnd(28)} ${direita}`.trimEnd();
      // "aguardando" e "rodando" são estados de tela; num log sequencial só o
      // desfecho interessa.
      if (l.estado !== "aguardando" && l.estado !== "rodando") finais.push(linha);
      return linha;
    });

    // A degradação é dita em voz alta: um resultado parcial silencioso passa
    // por completo, e é isso que a reorganização não pode deixar acontecer.
    const avisos = [...linhas.values()]
      .filter((l) => l.estado === "pronto" && l.degradado.length)
      .flatMap((l) =>
        l.degradado.map((d) =>
          c.gray(`  ! ${t(`analyzer.degraded.${d}` as MessageKey)}`)
        )
      );

    bloco.render(
      [c.bold(`  StarGuard`) + c.gray(`  ·  ${projeto}`), "", ...corpo, ...avisos].join("\n"),
      // Sem terminal, só o que já está em estado final é impresso — o
      // segundo argumento é o que separa "desenho" de "registro".
      [...finais, ...avisos]
    );
  };

  return {
    on(event: RunEvent) {
      switch (event.type) {
        case "run:start": {
          for (const e of (event.plan as ExecutionPlan).entries) {
            linhas.set(e.id, {
              id: e.id,
              estado: e.willRun ? "aguardando" : "pulado",
              detalhe: e.detail ?? "",
              motivo: e.reason,
              degradado: e.missingUpstream,
            });
          }
          esconderCursor();
          if (isInteractive()) {
            timer = setInterval(() => {
              tick++;
              desenha();
            }, 90);
          }
          desenha();
          break;
        }
        case "analyzer:start": {
          const l = linhas.get(event.id);
          if (l) l.estado = "rodando";
          desenha();
          break;
        }
        case "analyzer:progress": {
          const l = linhas.get(event.id);
          if (l) l.detalhe = event.message;
          break;
        }
        case "analyzer:done": {
          const l = linhas.get(event.id);
          if (l) {
            l.estado = "pronto";
            l.duracaoMs = event.durationMs;
            l.achados = contar(event.id, event.result);
            l.degradado = event.degraded;
          }
          desenha();
          break;
        }
        case "analyzer:error": {
          const l = linhas.get(event.id);
          if (l) {
            l.estado = "erro";
            l.detalhe = event.error.split("\n")[0]!.slice(0, 60);
          }
          desenha();
          break;
        }
        case "run:done": {
          if (timer) clearInterval(timer);
          desenha();
          bloco.fecha();
          mostrarCursor();
          break;
        }
      }
    },
  };
}

// ------------------------------------------------------------
// Achados achatados — a lista que se lê depois da execução
// ------------------------------------------------------------

export interface AchadoPlano {
  id: string;
  analyzer: AnalyzerId;
  severity: Vulnerability["severity"];
  ruleId: string;
  title: string;
  file: string;
  line?: number;
  description: string;
  suggestion?: string;
  codeSnippet?: string;
  cwe?: string;
  raw: unknown;
}

/** Junta o que os analisadores produziram numa lista só, ordenada por gravidade. */
export function achadosDe(run: AnalysisRun): AchadoPlano[] {
  const out: AchadoPlano[] = [];
  const peso = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

  const sast = run.outcomes.sast?.result as Vulnerability[] | undefined;
  for (const v of sast ?? []) {
    out.push({ ...comum(v), analyzer: "sast", raw: v });
  }

  const review = run.outcomes.business?.result as { findings?: Vulnerability[] } | undefined;
  for (const v of review?.findings ?? []) {
    out.push({ ...comum(v), analyzer: "business", raw: v });
  }

  // As skills PRECISAM entrar aqui.
  //
  // Ficaram de fora na primeira versão e o efeito foi o pior possível: rodar
  // `starguard skills arquivo.md` mostrava "Skills e prompts  2" na lista de
  // analisadores e, logo abaixo, "Nenhum achado 🎉". Dois achados reais,
  // reportados como repositório limpo. Só apareceu porque o comando foi
  // executado de verdade — nem o tipo nem o teste de unidade pegariam.
  //
  // (No VS Code a decisão é a oposta e está documentada em `findings.ts`: lá
  // eles não vão para o painel Problemas, porque a posição é dentro do texto
  // analisado e pode não corresponder ao arquivo aberto. Aqui a tabela é a
  // ÚNICA saída — omitir é esconder.)
  const skills = run.outcomes.skills?.result as SkillValidation[] | undefined;
  for (const s of skills ?? []) {
    for (const f of s.findings) {
      out.push({
        id: f.id,
        analyzer: "skills",
        severity: f.severity,
        ruleId: f.type,
        title: f.title,
        file: s.skillName,
        line: f.line,
        description: f.description,
        suggestion: f.recommendation,
        codeSnippet: f.snippet,
        raw: f,
      });
    }
  }

  const sca = run.outcomes.sca?.result as DependencyVuln[] | undefined;
  for (const d of sca ?? []) {
    out.push({
      id: d.id,
      analyzer: "sca",
      severity: d.severity,
      ruleId: d.cve,
      // `explain.title` é "Dependência vulnerável: {pkg}" — a mesma frase em
      // toda linha da tabela, onde a coluna já se chama PROBLEMA. Pacote e
      // versão são o que distingue uma linha da outra.
      title: `${d.package} ${d.installedVersion}${d.fixedVersion ? ` → ${d.fixedVersion}` : ""}`,
      // O arquivo é o MANIFESTO, não o lockfile que o scanner leu: é ali que a
      // correção mexe.
      file: d.manifest || d.lockfile || "package.json",
      description: d.explain?.whatItIs || d.description || d.title,
      suggestion: d.fixedVersion ? `→ ${d.fixedVersion}` : undefined,
      raw: d,
    });
  }

  return out.sort((a, b) => peso[a.severity] - peso[b.severity]);
}

function comum(v: Vulnerability) {
  return {
    id: v.id,
    severity: v.severity,
    ruleId: v.ruleId,
    title: v.explain?.title || v.title,
    file: v.file,
    line: v.line,
    description: v.explain?.whatItIs || v.description,
    suggestion: v.suggestion,
    codeSnippet: v.codeSnippet,
    cwe: v.cwe,
  };
}

const COR_SEVERIDADE: Record<string, (s: string) => string> = {
  critical: c.red,
  high: c.red,
  medium: c.yellow,
  low: c.blue,
  info: c.gray,
};

/** Tabela de achados. Vazia devolve a linha de "nada encontrado". */
export function tabelaDeAchados(achados: AchadoPlano[], locale: Locale): string {
  const t = (k: MessageKey, v?: Record<string, string | number>) =>
    translate(locale, k, v);

  if (!achados.length) return "\n  " + c.green(t("cli.noFindings")) + "\n";

  const cabecalho = [
    c.gray(t("cli.col.severity")),
    c.gray(t("cli.col.location")),
    c.gray(t("cli.col.rule")),
    c.gray(t("cli.col.title")),
  ];
  const corpo = achados.map((a) => [
    (COR_SEVERIDADE[a.severity] ?? c.gray)("●") + " " + a.severity,
    a.line ? `${a.file}:${a.line}` : a.file,
    a.ruleId,
    a.title,
  ]);

  return (
    "\n" +
    tabela([cabecalho, ...corpo], [10, 40, 26, null])
      .map((l) => "  " + l)
      .join("\n") +
    "\n"
  );
}
