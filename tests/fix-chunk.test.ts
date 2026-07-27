import { describe, it, expect } from "vitest";
import {
  validate,
  step4Schema,
  prSchema,
  prBatchSchema,
  FIX_CHUNK_SIZE,
  MAX_FILE_CHARS,
  MAX_PR_BODY,
  MAX_PR_TITLE,
  clampFix,
  clampPrBody,
  clampPrTitle,
} from "@/lib/validation";

// Arquivo com muitos achados derrubava a geração inteira com
// "alsoFix: Too big: expected array to have <=20 items". Gerar correção NÃO
// pode falhar por causa da quantidade — e cortar o excedente seria a perda
// silenciosa que o agrupamento por arquivo veio impedir (AUDITORIA.md#BUG-06).

function extra(i: number) {
  return {
    vulnerabilityId: `V-${i}`,
    description: `problema ${i}`,
    line: i,
    ruleId: "regra",
  };
}

function payload(n: number, extras: Record<string, unknown> = {}) {
  return {
    vulnerabilityId: "V-0",
    file: "src/api/handler.ts",
    originalCode: "const x = 1;",
    description: "problema principal",
    alsoFix: Array.from({ length: n }, (_, i) => extra(i + 1)),
    ...extras,
  };
}

/** A mesma divisão que o cliente faz antes de enviar. */
function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

describe("step4Schema · fatiamento por arquivo", () => {
  it("aceita uma fatia cheia", () => {
    const r = validate(step4Schema, payload(FIX_CHUNK_SIZE - 1));
    expect(r.ok).toBe(true);
  });

  it("recusa acima da fatia — o teto do servidor continua valendo", () => {
    const r = validate(step4Schema, payload(FIX_CHUNK_SIZE));
    expect(r.ok).toBe(false);
  });

  it("aceita `baseCode`, que é o que encadeia uma fatia na outra", () => {
    const r = validate(
      step4Schema,
      payload(3, { baseCode: "conteúdo já corrigido pela fatia anterior" })
    );
    expect(r.ok).toBe(true);
  });

  it("um arquivo com 80 achados vira fatias que TODAS passam", () => {
    // Era exatamente este o caso que falhava: 80 achados no mesmo arquivo.
    const achados = Array.from({ length: 80 }, (_, i) => extra(i + 1));
    const fatias = chunk(achados, FIX_CHUNK_SIZE);

    for (const [i, fatia] of fatias.entries()) {
      const [primeiro, ...resto] = fatia;
      const r = validate(step4Schema, {
        vulnerabilityId: primeiro!.vulnerabilityId,
        file: "src/api/handler.ts",
        originalCode: "x",
        description: primeiro!.description,
        // A partir da 2ª fatia, parte do resultado da anterior.
        baseCode: i > 0 ? "resultado da fatia anterior" : undefined,
        alsoFix: resto,
      });
      expect(r.ok, `fatia ${i + 1} de ${fatias.length} recusada`).toBe(true);
    }
  });

  it("nenhum achado se perde no fatiamento", () => {
    const achados = Array.from({ length: 80 }, (_, i) => extra(i + 1));
    const fatias = chunk(achados, FIX_CHUNK_SIZE);
    const total = fatias.reduce((n, f) => n + f.length, 0);
    expect(total).toBe(80);

    const ids = new Set(fatias.flat().map((a) => a.vulnerabilityId));
    expect(ids.size).toBe(80);
  });

  it("achado único não vira fatia vazia", () => {
    expect(chunk([extra(1)], FIX_CHUNK_SIZE)).toHaveLength(1);
    expect(chunk([], FIX_CHUNK_SIZE)).toHaveLength(0);
  });
});

describe("orçamento de tempo e de saída", () => {
  it("o timeout da correção cabe dentro do maxDuration da rota", async () => {
    // A rota declara maxDuration = 300 s. Um teto de IA maior que isso faria o
    // Next cortar a requisição antes de a chamada terminar — e o usuário veria
    // um erro genérico em vez do motivo.
    const { aiHttp } = await import("@/lib/config");
    expect(aiHttp("refactor").timeoutMs).toBeLessThan(300_000);
    expect(aiHttp("refactor").timeoutMs).toBeGreaterThan(
      aiHttp("plan").timeoutMs
    );
  });

  it("fatia grande o bastante para o caso comum caber numa chamada", () => {
    // O custo caro é a SAÍDA (reemitir o arquivo), e ela é por chamada. Fatia
    // pequena multiplica reescritas do mesmo arquivo.
    expect(FIX_CHUNK_SIZE).toBeGreaterThanOrEqual(50);
  });
});

// O PR era recusado DEPOIS de a correção ser gerada — jogando fora IA e
// minutos já pagos. Um limite que só dispara no último passo não protege
// nada; só desperdiça.
describe("tamanho de arquivo no PR", () => {
  const repoUrl = "https://github.com/acme/app";

  it("aceita um arquivo grande de verdade (o caso que falhava)", () => {
    // ~1 300 linhas de código denso passam de 50 000 caracteres — era o teto
    // antigo, e arquivo desse porte é comum.
    const grande = "x".repeat(120_000);
    expect(
      validate(prSchema, {
        repoUrl,
        file: "src/app/automations/page.js",
        fixedCode: grande,
        title: "fix",
      }).ok
    ).toBe(true);
  });

  it("aceita no lote, que é onde o erro aparecia", () => {
    const files = Array.from({ length: 12 }, (_, i) => ({
      file: `src/f${i}.ts`,
      fixedCode: "y".repeat(120_000),
    }));
    expect(validate(prBatchSchema, { repoUrl, files, title: "fix" }).ok).toBe(true);
  });

  it("recusa acima do que o GitHub aceita neste fluxo, com motivo legível", () => {
    const r = validate(prSchema, {
      repoUrl,
      file: "a.ts",
      fixedCode: "z".repeat(MAX_FILE_CHARS + 1),
      title: "fix",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/GitHub|MB/i);
  });

  it("trava o somatório do lote — 50 arquivos de 1 MB seriam 50 MB", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      file: `src/f${i}.ts`,
      fixedCode: "w".repeat(500_000),
    }));
    const r = validate(prBatchSchema, { repoUrl, files, title: "fix" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/partes|limite/i);
  });
});

// Varredura: NENHUM campo que nós montamos pode derrubar a requisição por
// tamanho. O corte é na origem; o schema é rede, não porteiro.
describe("corte na origem · nenhum limite quebra o fluxo", () => {
  const repoUrl = "https://github.com/acme/app";
  const gigante = "a".repeat(500_000);

  it("corpo de PR enorme é cortado, não recusado", () => {
    const body = clampPrBody(gigante);
    expect(body.length).toBeLessThanOrEqual(MAX_PR_BODY);
    expect(
      validate(prSchema, { repoUrl, file: "a.ts", fixedCode: "x", title: "t", body }).ok
    ).toBe(true);
  });

  it("o corte avisa que houve corte — texto sumindo em silêncio é pior", () => {
    expect(clampPrBody(gigante)).toMatch(/truncado/i);
  });

  it("título de achado que é um parágrafo vira título de PR válido", () => {
    const title = clampPrTitle(`Correção de segurança: ${gigante}`);
    expect(title.length).toBeLessThanOrEqual(MAX_PR_TITLE);
    expect(
      validate(prSchema, { repoUrl, file: "a.ts", fixedCode: "x", title }).ok
    ).toBe(true);
  });

  it("título normaliza quebras de linha — o GitHub não aceita", () => {
    expect(clampPrTitle("linha 1\nlinha 2")).toBe("linha 1 linha 2");
  });

  it("campos da correção cortados cabem no schema", () => {
    const r = validate(step4Schema, {
      vulnerabilityId: "V-1",
      file: "a.ts",
      originalCode: clampFix("originalCode", gigante),
      description: clampFix("description", gigante),
      suggestion: clampFix("suggestion", gigante),
      userInstructions: clampFix("userInstructions", gigante),
    });
    expect(r.ok).toBe(true);
  });

  it("undefined continua undefined — campo opcional não vira string vazia", () => {
    expect(clampFix("suggestion", undefined)).toBeUndefined();
  });

  it("texto dentro do limite passa intacto", () => {
    expect(clampFix("description", "curto")).toBe("curto");
    expect(clampPrBody("curto")).toBe("curto");
  });
});
