// ============================================================
// Extensão do VS Code — AUDITORIA.md#ARQ-13.
//
// Duas coisas sob teste. A primeira é o achatamento dos resultados para o
// painel Problemas: cada analisador devolve o SEU formato, e o editor precisa
// de um só. A segunda é que o bundle CARREGA — a extensão é CommonJS e o motor
// é ESM, e essa conversão é o único jeito de os dois se falarem. Se ela
// quebrar, a extensão não ativa, e o sintoma no editor é uma mensagem genérica
// que não diz nada sobre a causa.
// ============================================================
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { achadosDe } from "../src/findings";
import type { AnalysisRun, AnalyzerOutcome } from "@starguard/core/contracts";
import type { DependencyVuln, Vulnerability } from "@starguard/core/types";

function corrida(outcomes: Record<string, Partial<AnalyzerOutcome>>): AnalysisRun {
  return {
    plan: { entries: [], source: { type: "none" }, locale: "pt-BR", concurrency: 4 },
    outcomes: Object.fromEntries(
      Object.entries(outcomes).map(([id, o]) => [
        id,
        { id, status: "done", degraded: [], ...o } as AnalyzerOutcome,
      ])
    ),
    startedAt: 1,
    finishedAt: 2,
    ok: true,
  };
}

const vuln = (p: Partial<Vulnerability>): Vulnerability => ({
  id: "V-1",
  source: "sast",
  ruleId: "regra",
  title: "título do scanner",
  severity: "high",
  file: "src/app.ts",
  line: 10,
  description: "descrição crua",
  suggestion: "",
  ...p,
});

const dep = (p: Partial<DependencyVuln>): DependencyVuln => ({
  id: "D-1",
  source: "sca",
  package: "postcss",
  installedVersion: "8.4.31",
  severity: "high",
  cve: "CVE-1",
  title: "t",
  description: "d",
  ...p,
});

describe("achadosDe", () => {
  it("junta SAST, regras de negócio e dependências numa lista só", () => {
    const r = achadosDe(
      corrida({
        sast: { result: [vuln({ id: "V-1" })] },
        business: { result: { findings: [vuln({ id: "B-1", severity: "critical" })] } },
        sca: { result: [dep({ id: "D-1", manifest: "package.json" })] },
      })
    );
    expect(r.map((a) => a.id)).toEqual(["B-1", "V-1", "D-1"]);
    expect(r.map((a) => a.analyzer)).toEqual(["business", "sast", "sca"]);
  });

  it("ordena por GRAVIDADE, não por analisador", () => {
    // No painel Problemas o que importa é o que precisa de atenção primeiro.
    const r = achadosDe(
      corrida({
        sast: { result: [vuln({ id: "baixo", severity: "low" })] },
        sca: { result: [dep({ id: "critico", severity: "critical" })] },
      })
    );
    expect(r[0]!.id).toBe("critico");
  });

  it("prefere o título ENRIQUECIDO ao do scanner", () => {
    // O do scanner vem em inglês; o enriquecido vem no idioma configurado.
    // É metade do valor do FEAT-03, e no editor é a primeira coisa que se lê.
    const [a] = achadosDe(
      corrida({
        sast: {
          result: [
            vuln({
              title: "Insecure deserialization",
              explain: {
                title: "Desserialização insegura",
                whatItIs: "o que é",
                whyItMatters: "",
                howToFix: "",
                source: "catalog",
              },
            }),
          ],
        },
      })
    );
    expect(a!.title).toBe("Desserialização insegura");
    expect(a!.description).toBe("o que é");
  });

  it("dependência aponta o MANIFESTO, não o lockfile", () => {
    // O clique no painel Problemas leva ao arquivo. O lockfile é gerado por
    // ferramenta; abrir ele não ajuda ninguém — e não é onde a correção mexe.
    const [a] = achadosDe(
      corrida({
        sca: {
          result: [dep({ manifest: "package.json", lockfile: "package-lock.json" })],
        },
      })
    );
    expect(a!.file).toBe("package.json");
  });

  it("dependência mostra pacote, versão e o alvo da atualização", () => {
    const [a] = achadosDe(
      corrida({ sca: { result: [dep({ fixedVersion: "8.5.12" })] } })
    );
    expect(a!.title).toBe("postcss 8.4.31 → 8.5.12");
  });

  it("analisador pulado não contribui com nada", () => {
    const r = achadosDe(
      corrida({
        sast: { status: "skipped", reason: "not_selected", result: undefined },
        sca: { result: [dep({})] },
      })
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.analyzer).toBe("sca");
  });

  it("carrega o payload original — é dele que o corretor do analisador precisa", () => {
    const original = dep({ manifest: "package.json", fixedVersion: "9.0.0" });
    const [a] = achadosDe(corrida({ sca: { result: [original] } }));
    expect(a!.raw).toBe(original);
  });

  it("skills NÃO entram no painel Problemas", () => {
    // O achado de skill é sobre o texto de um prompt, e a posição é dentro do
    // conteúdo analisado — que pode não ser o arquivo aberto. Fingir uma
    // localização que não se tem seria pior que não mostrar.
    const r = achadosDe(
      corrida({
        skills: {
          result: [{ skillName: "s", verdict: "review", findings: [{}], checkedItems: [] }],
        },
      })
    );
    expect(r).toHaveLength(0);
  });
});

// ------------------------------------------------------------
// O bundle carrega no extension host?
// ------------------------------------------------------------

const DIST = new URL("../dist/extension.js", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

/**
 * Dublê do módulo `vscode`.
 *
 * Só precisa dos símbolos tocados na CARGA do arquivo (antes de `activate`).
 * Se algum dia o módulo passar a usar outra coisa no escopo de módulo, este
 * teste falha — que é exatamente o aviso que se quer, porque no editor a falha
 * apareceria como "a extensão não ativou", sem dizer por quê.
 */
function vscodeDublado() {
  class EventEmitter {
    event = () => ({ dispose() {} });
    fire() {}
  }
  return {
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CodeActionKind: { QuickFix: { value: "quickfix" } },
    EventEmitter,
    ThemeIcon: class {},
    Diagnostic: class {},
    Range: class {},
    Uri: { file: (p: string) => ({ fsPath: p }), parse: (s: string) => ({ toString: () => s }) },
    MarkdownString: class {},
    ProgressLocation: { Window: 10, Notification: 15 },
    window: { createOutputChannel: () => ({}), showQuickPick: () => undefined },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
    languages: {},
    commands: {},
  };
}

describe.skipIf(!existsSync(DIST))("bundle da extensão", () => {
  it("carrega como CommonJS e expõe activate/deactivate", () => {
    // A extensão é CJS e `@starguard/core` é ESM: sem a conversão do esbuild o
    // `require` do extension host não consegue carregar o motor.
    const require_ = createRequire(import.meta.url);
    const Module = require_("node:module") as {
      _load: (r: string, ...a: unknown[]) => unknown;
    };
    const original = Module._load;
    Module._load = function (req: string, ...a: unknown[]) {
      return req === "vscode" ? vscodeDublado() : original.call(this, req, ...a);
    };
    try {
      delete require_.cache?.[DIST];
      const m = require_(DIST) as Record<string, unknown>;
      expect(typeof m.activate).toBe("function");
      expect(typeof m.deactivate).toBe("function");
    } finally {
      Module._load = original;
    }
  });
});
