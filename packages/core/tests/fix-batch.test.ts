// ============================================================
// Correção em lote — AUDITORIA.md#UX-24.
//
// O que estes testes travam é o BUG-06 na sua forma nova. Ele já custou caro
// uma vez no painel: N correções para o mesmo arquivo, cada uma partindo do
// original, e o PR guardando só a última — com a tela dizendo que todas as N
// tinham sido aplicadas. Agora que a extensão também corrige em lote, a mesma
// armadilha existe no editor, e a defesa é a mesma: um arquivo, uma correção.
// ============================================================
import { describe, it, expect, vi } from "vitest";
import {
  FIX_CHUNK_SIZE,
  chunk,
  groupByFile,
  proposeForFile,
} from "../src/fix/batch";
import type { FixProposal, FixableFinding, Fixer } from "../src/contracts";

const achado = (id: string, file: string): FixableFinding => ({
  id,
  analyzer: "sast",
  title: id,
  severity: "high",
  file,
  description: "d",
});

/** Corretor de mentira: devolve o que mandarem e registra como foi chamado. */
function corretorFalso(
  resposta: (alvo: FixableFinding, ctx: { alsoFix?: FixableFinding[]; baseCode?: string }, n: number) => Partial<FixProposal>
): { fixer: Fixer; chamadas: { alvo: string; tambem: string[]; base?: string }[] } {
  const chamadas: { alvo: string; tambem: string[]; base?: string }[] = [];
  let n = 0;
  const fixer: Fixer = {
    can: () => ({ ok: true }),
    propose: async (alvo, ctx) => {
      chamadas.push({
        alvo: alvo.id,
        tambem: (ctx.alsoFix ?? []).map((f) => f.id),
        base: ctx.baseCode,
      });
      const r = resposta(alvo, ctx, n++);
      return {
        findingId: alvo.id,
        file: alvo.file,
        changes: [{ file: alvo.file, originalCode: "orig", fixedCode: "fix" }],
        explanation: "",
        engine: "api",
        noChange: false,
        ...r,
      };
    },
    apply: async () => {},
  };
  return { fixer, chamadas };
}

describe("agrupamento por arquivo (BUG-06 no editor)", () => {
  it("junta os achados do MESMO arquivo num grupo só", () => {
    const g = groupByFile([
      achado("A", "src/a.ts"),
      achado("B", "src/b.ts"),
      achado("C", "src/a.ts"),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]!.findings.map((f) => f.id)).toEqual(["A", "C"]);
    expect(g[1]!.findings.map((f) => f.id)).toEqual(["B"]);
  });

  it("`src\\a.ts` e `src/A.ts` são o MESMO arquivo", () => {
    // No Windows o scanner devolve barra invertida e o editor, barra normal.
    // Tratá-los como dois arquivos traria o BUG-06 de volta pela ortografia.
    const g = groupByFile([achado("A", "src\\a.ts"), achado("B", "src/A.ts")]);
    expect(g).toHaveLength(1);
    expect(g[0]!.findings.map((f) => f.id)).toEqual(["A", "B"]);
  });

  it("o rótulo do grupo é o caminho do primeiro achado, não um inventado", () => {
    const g = groupByFile([achado("A", "src\\a.ts"), achado("B", "src/a.ts")]);
    expect(g[0]!.file).toBe("src\\a.ts");
  });

  it("achado sem arquivo fica de fora — não há o que corrigir", () => {
    expect(groupByFile([achado("A", "  "), achado("B", "x.ts")])).toHaveLength(1);
  });

  it("preserva a ordem de chegada dos grupos", () => {
    const g = groupByFile([achado("A", "z.ts"), achado("B", "a.ts")]);
    expect(g.map((x) => x.file)).toEqual(["z.ts", "a.ts"]);
  });
});

describe("fatiamento", () => {
  it("nada sobra de fora", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("lista menor que a fatia vira uma fatia só", () => {
    expect(chunk([1], 60)).toEqual([[1]]);
  });

  it("lista vazia não gera fatia", () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it("o teto é o mesmo do painel", () => {
    expect(FIX_CHUNK_SIZE).toBe(60);
  });
});

describe("uma proposta por arquivo", () => {
  it("o primeiro achado é o alvo e os outros viajam em `alsoFix`", async () => {
    const { fixer, chamadas } = corretorFalso(() => ({}));
    await proposeForFile(
      fixer,
      { file: "a.ts", findings: [achado("A", "a.ts"), achado("B", "a.ts"), achado("C", "a.ts")] },
      { locale: "pt-BR" }
    );
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ alvo: "A", tambem: ["B", "C"] });
  });

  it("as fatias são ENCADEADAS: a segunda parte do resultado da primeira", async () => {
    const { fixer, chamadas } = corretorFalso((alvo, _ctx, n) => ({
      changes: [{ file: alvo.file, originalCode: "v0", fixedCode: `v${n + 1}` }],
    }));
    await proposeForFile(
      fixer,
      { file: "a.ts", findings: [achado("A", "a.ts"), achado("B", "a.ts")] },
      { locale: "pt-BR" },
      { chunkSize: 1 }
    );
    expect(chamadas.map((c) => c.base)).toEqual([undefined, "v1"]);
  });

  it("o `originalCode` é o da PRIMEIRA fatia — senão o diff esconde metade", async () => {
    // Sem isto, a segunda fatia mostraria como "antes" o que a primeira já
    // tinha corrigido: quem revisasse veria só a última mudança.
    const { fixer } = corretorFalso((alvo, ctx, n) => ({
      changes: [
        { file: alvo.file, originalCode: ctx.baseCode ?? "original", fixedCode: `v${n + 1}` },
      ],
    }));
    const p = await proposeForFile(
      fixer,
      { file: "a.ts", findings: [achado("A", "a.ts"), achado("B", "a.ts")] },
      { locale: "pt-BR" },
      { chunkSize: 1 }
    );
    expect(p.changes).toEqual([
      { file: "a.ts", originalCode: "original", fixedCode: "v2" },
    ]);
  });

  it("arquivo tocado por uma fatia anterior não some do resultado", async () => {
    // O corretor de agente pode mexer em mais de um arquivo. Sem acumular, o
    // que a primeira fatia mudou em `outro.ts` sumiria do lote — é o BUG-07.
    const { fixer } = corretorFalso((alvo, _ctx, n) =>
      n === 0
        ? {
            changes: [
              { file: "a.ts", originalCode: "o", fixedCode: "a1" },
              { file: "outro.ts", originalCode: "o2", fixedCode: "b1" },
            ],
          }
        : { changes: [{ file: "a.ts", originalCode: "a1", fixedCode: "a2" }] }
    );
    const p = await proposeForFile(
      fixer,
      { file: "a.ts", findings: [achado("A", "a.ts"), achado("B", "a.ts")] },
      { locale: "pt-BR" },
      { chunkSize: 1 }
    );
    expect(p.changes.map((c) => c.file).sort()).toEqual(["a.ts", "outro.ts"]);
    expect(p.changes.find((c) => c.file === "a.ts")!.fixedCode).toBe("a2");
    expect(p.changes.find((c) => c.file === "outro.ts")!.fixedCode).toBe("b1");
  });

  it("`noChange` olha o LOTE, não a última fatia", async () => {
    // A última fatia pode não ter mudado nada e a primeira ter mudado tudo.
    const { fixer } = corretorFalso((alvo, _ctx, n) =>
      n === 0
        ? { changes: [{ file: "a.ts", originalCode: "o", fixedCode: "novo" }] }
        : { noChange: true, changes: [{ file: "a.ts", originalCode: "novo", fixedCode: "novo" }] }
    );
    const p = await proposeForFile(
      fixer,
      { file: "a.ts", findings: [achado("A", "a.ts"), achado("B", "a.ts")] },
      { locale: "pt-BR" },
      { chunkSize: 1 }
    );
    expect(p.noChange).toBe(false);
    expect(p.changes[0]!.fixedCode).toBe("novo");
  });

  it("cancelamento interrompe entre fatias, sem descartar o que já saiu", async () => {
    const controle = new AbortController();
    const { fixer, chamadas } = corretorFalso((alvo) => {
      controle.abort();
      return { changes: [{ file: alvo.file, originalCode: "o", fixedCode: "f" }] };
    });
    const p = await proposeForFile(
      fixer,
      { file: "a.ts", findings: [achado("A", "a.ts"), achado("B", "a.ts")] },
      { locale: "pt-BR", signal: controle.signal },
      { chunkSize: 1 }
    );
    expect(chamadas).toHaveLength(1);
    expect(p.changes[0]!.fixedCode).toBe("f");
  });

  it("corretor que lança não é engolido — quem chamou decide o que fazer", async () => {
    const fixer: Fixer = {
      can: () => ({ ok: true }),
      propose: vi.fn().mockRejectedValue(new Error("sem crédito")),
      apply: async () => {},
    };
    await expect(
      proposeForFile(fixer, { file: "a.ts", findings: [achado("A", "a.ts")] }, { locale: "pt-BR" })
    ).rejects.toThrow("sem crédito");
  });
});
