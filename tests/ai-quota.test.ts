// ============================================================
// Cota de IA — AUDITORIA.md#SEC-11.
//
// Aqui o caminho negativo é dinheiro: com pre-commit, PR e commit na main
// disparando análise, um repositório ativo gera dezenas de execuções por dia.
// Um erro de cálculo não aparece na tela — aparece na fatura, no fim do mês.
//
// A parte pura (preço, custo, janela do mês) tem teste aqui; a soma contra o
// Postgres fica em `tests/live-oauth.test.ts`-style, por `npm run test:live`.
// ============================================================
import { describe, it, expect, vi } from "vitest";

// `lib/ai-quota` importa `@/lib/db` no topo. O banco não participa das funções
// puras, mas o import precisa resolver.
vi.mock("@/lib/db", () => ({ db: {} }));

const { custoMicroUsd, mesAtual, proximaRenovacao, MONTHLY_BUDGET_USD } = await import(
  "@/lib/ai-quota"
);

describe("custo", () => {
  it("cobra entrada e saída com preços diferentes", () => {
    // Saída custa 5× a entrada no Sonnet — inverter os dois subestimaria a
    // conta em quase uma ordem de grandeza no uso típico (prompt grande,
    // resposta menor).
    const so_entrada = custoMicroUsd("claude-sonnet-5", 1_000_000, 0);
    const so_saida = custoMicroUsd("claude-sonnet-5", 0, 1_000_000);
    expect(so_entrada).toBe(3_000_000); // US$ 3,00
    expect(so_saida).toBe(15_000_000); // US$ 15,00
  });

  it("casa o modelo por PREFIXO — o provedor versiona o id", () => {
    // `claude-sonnet-5-20260101` tem de cair no preço do Sonnet, não no
    // fallback. Sem isso, toda atualização de data do modelo passaria a cobrar
    // preço de Opus.
    expect(custoMicroUsd("claude-sonnet-5-20260101", 1_000_000, 0)).toBe(3_000_000);
  });

  it("modelo DESCONHECIDO usa o fallback caro, não zero", () => {
    // Cobrar a mais é recuperável; deixar de cobrar não. Um modelo novo não
    // pode fazer a cota parar de contar.
    expect(custoMicroUsd("modelo-que-nao-existe", 1_000_000, 0)).toBeGreaterThan(0);
  });

  it("devolve INTEIRO — é o que evita erro acumulado", () => {
    // Somar 0.000042 mil vezes em ponto flutuante desvia; um relatório de
    // cobrança que não fecha é pior que não ter relatório.
    const c = custoMicroUsd("claude-sonnet-5", 1234, 567);
    expect(Number.isInteger(c)).toBe(true);
  });

  it("chamada minúscula não vira zero por arredondamento", () => {
    expect(custoMicroUsd("claude-sonnet-5", 100, 100)).toBeGreaterThan(0);
  });

  it("zero tokens custa zero", () => {
    expect(custoMicroUsd("claude-sonnet-5", 0, 0)).toBe(0);
  });

  it("uma análise realista fica dentro do esperado", () => {
    // 40 arquivos de contexto (~150k tokens) + JSON de saída (~8k) numa
    // revisão por IA. Se isto passasse de alguns dólares, o teto de US$ 50
    // cobriria pouquíssimas execuções e a cota estaria mal dimensionada.
    const usd = custoMicroUsd("claude-sonnet-5", 150_000, 8_000) / 1e6;
    expect(usd).toBeGreaterThan(0.4);
    expect(usd).toBeLessThan(1.0);
  });
});

describe("janela mensal", () => {
  it("o mês é YYYY-MM em UTC", () => {
    expect(mesAtual(new Date("2026-08-04T23:00:00Z"))).toBe("2026-08");
    expect(mesAtual(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("usa UTC, não o fuso do servidor", () => {
    // Sem isso, a virada do mês aconteceria em horas diferentes conforme onde
    // o processo roda — e uma conta poderia gastar duas vezes o teto na virada.
    expect(mesAtual(new Date("2026-08-31T23:30:00Z"))).toBe("2026-08");
    expect(mesAtual(new Date("2026-09-01T00:30:00Z"))).toBe("2026-09");
  });

  it("a renovação é o primeiro instante do mês seguinte", () => {
    const r = proximaRenovacao(new Date("2026-08-15T12:00:00Z"));
    expect(r.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("dezembro renova em janeiro do ano seguinte", () => {
    const r = proximaRenovacao(new Date("2026-12-20T12:00:00Z"));
    expect(r.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("orçamento", () => {
  it("tem um teto definido e positivo", () => {
    // Sem teto, "cota por conta" não existe — e a fatura é imprevisível.
    expect(MONTHLY_BUDGET_USD).toBeGreaterThan(0);
  });
});
