// ============================================================
// Banco inalcançável na subida: dizer PARA ONDE, uma vez.
//
// `verifySchemaOnBoot` calava quando o banco não respondia — de propósito, para
// não alarmar por oscilação de rede. O deploy de 07/08/2026 mostrou o preço: o
// processo subiu, o healthcheck respondeu 503, o Coolify reverteu, e a única
// pista era o worker repetindo SQL. Nada, em lugar nenhum, dizia qual endereço
// não respondia — que era o defeito.
//
// Ver AUDITORIA.md#BUG-30.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const checkSchema = vi.fn();
vi.mock("@/lib/schema-check", () => ({
  checkSchema: () => checkSchema(),
  schemaMessage: (s: { pending: string[] }) =>
    `Banco desatualizado: ${s.pending.length} migração(ões) pendente(s).`,
  MIGRATE_HINT: "npm run db:migrate",
}));

const { verifySchemaOnBoot, dicaDeConexao } = await import("@/lib/boot-check");
const { alvoDoBanco } = await import("@/lib/db");

const URL_ORIGINAL = process.env.DATABASE_URL;
let saida: string[];

beforeEach(() => {
  saida = [];
  vi.spyOn(console, "error").mockImplementation((m: unknown) => {
    saida.push(String(m));
  });
  checkSchema.mockReset();
  process.env.DATABASE_URL = "postgres://sg:senha-secreta@db-interno:5433/starguard";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (URL_ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = URL_ORIGINAL;
});

const INALCANCAVEL = {
  ok: false,
  expected: 9,
  applied: 0,
  pending: [] as string[],
  error: "Connection terminated due to connection timeout",
};

describe("alvoDoBanco", () => {
  it("diz host e porta — a informação que faltava no log da produção", () => {
    expect(alvoDoBanco()).toBe("db-interno:5433/starguard");
  });

  it("NÃO vaza a senha: este texto vai para o log e para a tela", () => {
    // A regra de `redact.ts` vale aqui pelo mesmo motivo de sempre — só que
    // este texto é construído por nós, então a única defesa é não montá-lo com
    // a credencial dentro.
    expect(alvoDoBanco()).not.toContain("senha-secreta");
    expect(alvoDoBanco()).not.toContain("sg:");
  });

  it("completa a porta padrão quando a URL não traz — 5432 não é óbvio para todos", () => {
    process.env.DATABASE_URL = "postgres://sg@db/starguard";

    expect(alvoDoBanco()).toBe("db:5432/starguard");
  });

  it("não estoura com URL ilegível: quem chama está relatando um erro", () => {
    // Uma função de diagnóstico que lança apaga a mensagem que ia ser dada — e
    // «DATABASE_URL ilegível» é, ela própria, o diagnóstico.
    process.env.DATABASE_URL = "isto-nao-e-uma-url";

    expect(alvoDoBanco()).toBe("(DATABASE_URL ilegível)");
  });

  it("sem DATABASE_URL, diz isso — e não «undefined:5432»", () => {
    delete process.env.DATABASE_URL;

    expect(alvoDoBanco()).toBe("(DATABASE_URL ausente)");
  });
});

// Uma dica ERRADA é pior que nenhuma: mandar conferir firewall quando a senha
// está errada custa a mesma hora que o silêncio custava, com a desvantagem de
// parecer informação.
describe("dicaDeConexao — cada erro manda olhar num lugar diferente", () => {
  it("timeout: rede, e diz que o Postgres pode estar ótimo", () => {
    const d = dicaDeConexao("Connection terminated due to connection timeout");

    expect(d).toMatch(/descartado/i);
    expect(d).toMatch(/rede docker|firewall/i);
  });

  it("recusado: NÃO manda olhar firewall — a máquina respondeu", () => {
    const d = dicaDeConexao("connect ECONNREFUSED 10.0.0.5:5432");

    expect(d).toMatch(/nada escutando/i);
    expect(d).not.toMatch(/descartado/i);
  });

  it("nome não resolve: rede errada, e não porta", () => {
    expect(dicaDeConexao("getaddrinfo ENOTFOUND postgres-abc")).toMatch(/não resolve/i);
  });

  it("credencial: manda PARAR de olhar a rede", () => {
    // O erro mais caro de diagnóstico é o que faz alguém depurar a camada certa
    // pelo motivo errado. Aqui a conexão chegou; insistir em rede é tempo
    // perdido, e a dica diz isso com todas as letras.
    const d = dicaDeConexao('[28P01] password authentication failed for user "sg"');

    expect(d).toMatch(/CHEGOU no Postgres/);
    expect(d).toMatch(/não perca tempo/i);
  });

  it("erro que não reconhece não inventa causa", () => {
    const d = dicaDeConexao("algo completamente inesperado");

    expect(d).toMatch(/DATABASE_URL/);
    expect(d).not.toMatch(/firewall|credencial|não resolve/i);
  });
});

describe("verifySchemaOnBoot com o banco INALCANÇÁVEL", () => {
  it("não cala mais — era o silêncio que deixou o deploy sem pista", async () => {
    checkSchema.mockResolvedValue(INALCANCAVEL);

    await verifySchemaOnBoot();

    expect(saida.length).toBeGreaterThan(0);
  });

  it("nomeia o host:porta que não respondeu", async () => {
    checkSchema.mockResolvedValue(INALCANCAVEL);

    await verifySchemaOnBoot();

    expect(saida.join("\n")).toContain("db-interno:5433");
  });

  it("separa «timeout» de «recusado» — são consertos diferentes", async () => {
    // Pacote descartado (rede errada, firewall) contra porta fechada (Postgres
    // no chão). O log da produção dizia «timeout» e ninguém leu isso como
    // «rede», que era a resposta.
    checkSchema.mockResolvedValue(INALCANCAVEL);

    await verifySchemaOnBoot();

    expect(saida.join("\n")).toMatch(/pacote descartado/i);
  });

  it("aponta o db-doctor", async () => {
    checkSchema.mockResolvedValue(INALCANCAVEL);

    await verifySchemaOnBoot();

    expect(saida.join("\n")).toContain("scripts/db-doctor.mjs");
  });

  it("carrega o erro original junto", async () => {
    checkSchema.mockResolvedValue(INALCANCAVEL);

    await verifySchemaOnBoot();

    expect(saida.join("\n")).toContain("Connection terminated due to connection timeout");
  });

  it("não confunde com schema atrasado: ali a resposta é `db:migrate`", async () => {
    checkSchema.mockResolvedValue({
      ok: false,
      expected: 9,
      applied: 7,
      pending: ["0007_x", "0008_y"],
    });

    await verifySchemaOnBoot();

    const texto = saida.join("\n");
    expect(texto).toContain("Banco desatualizado");
    expect(texto).not.toMatch(/INALCANÇÁVEL/);
  });

  it("schema em dia é silêncio — o aviso só existe quando há o que avisar", async () => {
    checkSchema.mockResolvedValue({ ok: true, expected: 9, applied: 9, pending: [] });

    await verifySchemaOnBoot();

    expect(saida).toEqual([]);
  });
});
