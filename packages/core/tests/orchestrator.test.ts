// ============================================================
// O orquestrador — AUDITORIA.md#ARQ-13.
//
// O que estes testes travam é exatamente o que a reorganização prometeu: que
// dá para pedir UM analisador, que a falta de um vizinho degrada em vez de
// bloquear, e que um analisador quebrado não leva os outros junto. Sem eles, a
// próxima pessoa a mexer no `run()` reintroduz o pipeline linear sem perceber.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  Analyzer,
  ExecutionPlan,
  RunEvent,
  Sink,
  Workspace,
} from "../src/contracts";
import type { AnalyzerId } from "../src/types";

// O registro real carrega os cinco analisadores de verdade (e o Semgrep, e o
// Trivy). Aqui o que está sob teste é a MECÂNICA do orquestrador, então o
// registro é dublado — cada teste monta os analisadores de que precisa.
const registro = vi.hoisted(() => ({ analyzers: [] as Analyzer[] }));

vi.mock("../src/registry", () => ({
  allAnalyzers: () => registro.analyzers,
  getAnalyzer: (id: AnalyzerId) => registro.analyzers.find((a) => a.id === id),
  resolveSelection: (select?: readonly string[] | "all") => {
    if (!select || select === "all" || select.length === 0) {
      return registro.analyzers.map((a) => a.id);
    }
    const pedidos = new Set(select);
    return registro.analyzers.map((a) => a.id).filter((id) => pedidos.has(id));
  },
}));

const abrirWorkspace = vi.hoisted(() => vi.fn());
vi.mock("../src/workspace", () => ({ openWorkspace: abrirWorkspace }));

const { plan, run, analyze } = await import("../src/orchestrator");

/** Analisador de mentira: registra quando rodou e devolve o que mandarem. */
function fake(
  id: AnalyzerId,
  opts: Partial<Analyzer> & { resultado?: unknown; erro?: Error; atraso?: number } = {}
): Analyzer {
  return {
    id,
    needs: opts.needs ?? { workspace: false, ai: false },
    uses: opts.uses,
    probe: opts.probe ?? (async () => ({ ok: true })),
    run:
      opts.run ??
      (async () => {
        if (opts.atraso) await new Promise((r) => setTimeout(r, opts.atraso));
        if (opts.erro) throw opts.erro;
        return opts.resultado ?? { id };
      }),
  };
}

function workspaceFalso(): Workspace & { descartes: number } {
  const ws = {
    kind: "local" as const,
    root: "/tmp/x",
    descartes: 0,
    async readFile() {
      return null;
    },
    async writeFile() {},
    async dispose() {
      ws.descartes++;
    },
  };
  return ws;
}

/** Sink que só guarda os eventos, para as asserções lerem depois. */
function coletor(): Sink & { eventos: RunEvent[] } {
  const eventos: RunEvent[] = [];
  return { eventos, on: (e) => void eventos.push(e) };
}

beforeEach(() => {
  registro.analyzers = [];
  abrirWorkspace.mockReset();
  abrirWorkspace.mockResolvedValue(workspaceFalso());
});

afterEach(() => vi.clearAllMocks());

describe("plan() — a seleção decide quem entra", () => {
  it("um único analisador escolhido roda; os outros ficam de fora COM motivo", async () => {
    registro.analyzers = [fake("sast"), fake("sca"), fake("business")];

    const p = await plan({ select: ["sca"], source: { type: "local", path: "." } });

    const porId = Object.fromEntries(p.entries.map((e) => [e.id, e]));
    expect(porId.sca!.willRun).toBe(true);
    // O ponto do UX-15 levado para a seleção: nunca sumir em silêncio.
    expect(porId.sast!.willRun).toBe(false);
    expect(porId.sast!.reason).toBe("not_selected");
    expect(porId.business!.reason).toBe("not_selected");
  });

  it("seleção vazia significa TODOS — é o que `starguard scan` sem flag faz", async () => {
    registro.analyzers = [fake("sast"), fake("sca")];
    const p = await plan({ select: [], source: { type: "local", path: "." } });
    expect(p.entries.filter((e) => e.willRun).map((e) => e.id)).toEqual(["sast", "sca"]);
  });

  it("analisador indisponível fica de fora com o motivo que o probe deu", async () => {
    registro.analyzers = [
      fake("sast", {
        probe: async () => ({ ok: false, reason: "binary_missing", detail: "opengrep" }),
      }),
    ];
    const p = await plan({ source: { type: "local", path: "." } });
    expect(p.entries[0]!.willRun).toBe(false);
    expect(p.entries[0]!.reason).toBe("binary_missing");
    // O detalhe carrega o NOME do binário: "instale o opengrep" é acionável.
    expect(p.entries[0]!.detail).toBe("opengrep");
  });

  it("probe que LANÇA não derruba o plano inteiro", async () => {
    registro.analyzers = [
      fake("sast", {
        probe: async () => {
          throw new Error("execFile explodiu");
        },
      }),
      fake("sca"),
    ];
    const p = await plan({ source: { type: "local", path: "." } });
    expect(p.entries.find((e) => e.id === "sast")!.willRun).toBe(false);
    expect(p.entries.find((e) => e.id === "sca")!.willRun).toBe(true);
  });

  it("registra o upstream que ficou fora do plano como degradação", async () => {
    registro.analyzers = [
      fake("sast"),
      fake("sca"),
      fake("threat"),
      fake("business", { uses: ["sast", "sca", "threat"] }),
    ];

    const p = await plan({ select: ["business"], source: { type: "local", path: "." } });

    const business = p.entries.find((e) => e.id === "business")!;
    expect(business.willRun).toBe(true);
    // Os três estão disponíveis e mesmo assim faltam, porque não foram
    // ESCOLHIDOS. O orquestrador não os arrasta para dentro do plano: registra
    // o que faltou e roda com menos contexto.
    expect(business.missingUpstream).toEqual(["sast", "sca", "threat"]);
  });

  it("só é degradação o que faltou — com o upstream escolhido, a lista fica vazia", async () => {
    registro.analyzers = [fake("sast"), fake("business", { uses: ["sast"] })];

    const p = await plan({
      select: ["sast", "business"],
      source: { type: "local", path: "." },
    });

    expect(p.entries.find((e) => e.id === "business")!.missingUpstream).toEqual([]);
  });
});

describe("run() — dependência é enriquecimento, não pré-requisito", () => {
  it("SÓ regras de negócio roda, mesmo sem o SAST no plano", async () => {
    const rodou: AnalyzerId[] = [];
    registro.analyzers = [
      fake("sast", { run: async () => void rodou.push("sast") }),
      fake("business", {
        uses: ["sast"],
        run: async () => {
          rodou.push("business");
          return { findings: [] };
        },
      }),
    ];

    const p = await plan({ select: ["business"], source: { type: "local", path: "." } });
    const r = await run(p);

    // O SAST NÃO foi arrastado junto — é isto que diferencia o orquestrador do
    // pipeline linear que existia antes.
    expect(rodou).toEqual(["business"]);
    expect(r.outcomes.business!.status).toBe("done");
    expect(r.outcomes.business!.degraded).toEqual(["sast"]);
    expect(r.outcomes.sast!.status).toBe("skipped");
  });

  it("com os dois no plano, o upstream chega ao downstream", async () => {
    const vistos: unknown[] = [];
    registro.analyzers = [
      fake("sast", { resultado: [{ id: "V-1" }] }),
      fake("business", {
        uses: ["sast"],
        run: async (ctx) => {
          vistos.push(ctx.upstream.sastFindings);
          return { findings: [] };
        },
      }),
    ];

    const p = await plan({ source: { type: "local", path: "." } });
    const r = await run(p);

    expect(vistos[0]).toEqual([{ id: "V-1" }]);
    expect(r.outcomes.business!.degraded).toEqual([]);
  });

  it("upstream que FALHOU não trava quem espera por ele", async () => {
    registro.analyzers = [
      fake("sast", { erro: new Error("binário sumiu") }),
      fake("business", { uses: ["sast"], resultado: { findings: [] } }),
    ];

    const p = await plan({ source: { type: "local", path: "." } });
    const r = await run(p);

    expect(r.outcomes.sast!.status).toBe("error");
    // Esperar para sempre por um opcional seria travar a execução inteira.
    expect(r.outcomes.business!.status).toBe("done");
  });
});

describe("run() — isolamento de falha (AUDITORIA.md#UX-15)", () => {
  it("analisador que lança não apaga o resultado dos outros", async () => {
    registro.analyzers = [
      fake("sast", { erro: new Error("opengrep não encontrado") }),
      fake("sca", { resultado: [{ id: "D-1" }] }),
    ];

    const p = await plan({ source: { type: "local", path: "." } });
    const r = await run(p);

    expect(r.ok).toBe(false);
    expect(r.outcomes.sast!.status).toBe("error");
    expect(r.outcomes.sast!.error).toContain("opengrep");
    expect(r.outcomes.sca!.status).toBe("done");
    expect(r.outcomes.sca!.result).toEqual([{ id: "D-1" }]);
  });

  it("sink que lança não derruba a execução", async () => {
    registro.analyzers = [fake("sca", { resultado: [] })];
    const sinkQuebrado: Sink = {
      on() {
        throw new Error("banco fora do ar");
      },
    };

    const p = await plan({ source: { type: "local", path: "." } });
    const r = await run(p, { sinks: [sinkQuebrado] });

    expect(r.ok).toBe(true);
    expect(r.outcomes.sca!.status).toBe("done");
  });
});

describe("run() — paralelismo e workspace", () => {
  it("independentes rodam ao mesmo tempo, não em fila", async () => {
    let simultaneos = 0;
    let pico = 0;
    const concorrente = (id: AnalyzerId) =>
      fake(id, {
        run: async () => {
          pico = Math.max(pico, ++simultaneos);
          await new Promise((r) => setTimeout(r, 20));
          simultaneos--;
          return {};
        },
      });
    registro.analyzers = [concorrente("sast"), concorrente("sca"), concorrente("skills")];

    const p = await plan({ source: { type: "local", path: "." } });
    await run(p);

    expect(pico).toBeGreaterThan(1);
  });

  it("quem declara `uses` espera o upstream — o resto não espera ninguém", async () => {
    const ordem: string[] = [];
    registro.analyzers = [
      fake("sast", {
        run: async () => {
          await new Promise((r) => setTimeout(r, 20));
          ordem.push("sast");
          return [];
        },
      }),
      fake("business", {
        uses: ["sast"],
        run: async () => {
          ordem.push("business");
          return { findings: [] };
        },
      }),
    ];

    const p = await plan({ source: { type: "local", path: "." } });
    await run(p);

    expect(ordem).toEqual(["sast", "business"]);
  });

  it("o workspace é aberto UMA vez e descartado UMA vez", async () => {
    const ws = workspaceFalso();
    abrirWorkspace.mockResolvedValue(ws);
    registro.analyzers = [
      fake("sast", { needs: { workspace: true, ai: false } }),
      fake("sca", { needs: { workspace: true, ai: false } }),
    ];

    const p = await plan({ source: { type: "local", path: "." } });
    await run(p);

    // Antes, o scan clonava para si e a correção clonava outra vez.
    expect(abrirWorkspace).toHaveBeenCalledTimes(1);
    expect(ws.descartes).toBe(1);
  });

  it("não abre workspace quando nenhum analisador do plano precisa de código", async () => {
    registro.analyzers = [fake("skills", { needs: { workspace: false, ai: false } })];

    const p = await plan({ select: ["skills"], skills: [{ name: "s", content: "x" }] });
    await run(p, { skills: [{ name: "s", content: "x" }] });

    // `starguard skills arquivo.md` não pode clonar repositório nenhum.
    expect(abrirWorkspace).not.toHaveBeenCalled();
  });

  it("workspace passado de fora não é descartado por quem não o abriu", async () => {
    const ws = workspaceFalso();
    registro.analyzers = [fake("sast", { needs: { workspace: true, ai: false } })];

    const p = await plan({ source: { type: "local", path: "." } });
    await run(p, { workspace: ws });

    // A extensão do VS Code reaproveita o workspace entre execuções; descartá-lo
    // aqui invalidaria o dela.
    expect(abrirWorkspace).not.toHaveBeenCalled();
    expect(ws.descartes).toBe(0);
  });
});

describe("run() — eventos", () => {
  it("emite início, pulados, término de cada um e fim da corrida", async () => {
    registro.analyzers = [
      fake("sast", { resultado: [] }),
      fake("sca", { erro: new Error("x") }),
      fake("skills"),
    ];
    const sink = coletor();

    const p = await plan({ select: ["sast", "sca"], source: { type: "local", path: "." } });
    await run(p, { sinks: [sink] });

    const tipos = sink.eventos.map((e) => e.type);
    expect(tipos).toContain("run:start");
    expect(tipos).toContain("analyzer:skipped");
    expect(tipos).toContain("analyzer:done");
    expect(tipos).toContain("analyzer:error");
    expect(tipos).toContain("run:done");

    const fim = sink.eventos.find((e) => e.type === "run:done");
    expect(fim && "ok" in fim && fim.ok).toBe(false);
  });
});

describe("analyze() — o atalho que as três interfaces usam", () => {
  it("monta o plano e executa numa chamada", async () => {
    registro.analyzers = [fake("sca", { resultado: [{ id: "D-1" }] })];

    const r = await analyze({ select: ["sca"], source: { type: "local", path: "." } });

    expect(r.outcomes.sca!.result).toEqual([{ id: "D-1" }]);
    expect(r.ok).toBe(true);
  });
});

describe("ExecutionPlan é inspecionável antes de rodar", () => {
  it("montar o plano NÃO executa analisador nenhum", async () => {
    const executou = vi.fn();
    registro.analyzers = [fake("sast", { run: executou })];

    const p: ExecutionPlan = await plan({ source: { type: "local", path: "." } });

    // É esta garantia que permite o seletor da tela, o `doctor` e a árvore do
    // VS Code perguntarem "o que rodaria?" sem gastar um clone nem um token.
    expect(executou).not.toHaveBeenCalled();
    expect(p.entries).toHaveLength(1);
  });
});

describe("cancelamento entre rodadas — AUDITORIA.md#UX-24", () => {
  it("o que ainda não começou NÃO começa depois do abort", async () => {
    // O `signal` já chegava a cada analisador, mas quem obedece a ele é a
    // chamada de rede. O que estava na fila arrancava do mesmo jeito: clicar
    // em "cancelar" parava um e deixava os outros rodando.
    const controle = new AbortController();
    const segundo = vi.fn(async () => ({}));
    registro.analyzers = [
      fake("sast", {
        run: async () => {
          controle.abort();
          return [];
        },
      }),
      // `uses` obriga a segunda rodada — é lá que o abort é conferido.
      fake("business", { uses: ["sast"], run: segundo }),
    ];

    const p = await plan({ select: ["sast", "business"], source: { type: "local", path: "." } });
    const r = await run(p, { signal: controle.signal });

    expect(segundo).not.toHaveBeenCalled();
    expect(r.outcomes.business!.status).toBe("skipped");
    expect(r.outcomes.business!.reason).toBe("cancelled");
  });

  it("cancelado NÃO é erro: a execução não vira falha por causa do botão", async () => {
    const controle = new AbortController();
    registro.analyzers = [
      fake("sast", { run: async () => { controle.abort(); return []; } }),
      fake("business", { uses: ["sast"] }),
    ];

    const p = await plan({ select: ["sast", "business"], source: { type: "local", path: "." } });
    const r = await run(p, { signal: controle.signal });

    expect(r.ok).toBe(true);
  });

  it("quem já terminou continua no resultado", async () => {
    const controle = new AbortController();
    registro.analyzers = [
      fake("sast", { run: async () => { controle.abort(); return [{ id: "V-1" }]; } }),
      fake("business", { uses: ["sast"] }),
    ];

    const p = await plan({ select: ["sast", "business"], source: { type: "local", path: "." } });
    const r = await run(p, { signal: controle.signal });

    expect(r.outcomes.sast!.result).toEqual([{ id: "V-1" }]);
  });
});
