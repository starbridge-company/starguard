// ============================================================
// Vivacidade ≠ prontidão — o que travou o deploy de 07/08/2026.
//
// `/api/health` responde por PRONTIDÃO: 503 enquanto o banco não estiver
// alcançável e migrado. Isso está certo, e continua. O que estava errado é o
// `HEALTHCHECK` do Dockerfile apontar para ela: o Coolify usa o healthcheck do
// Docker como PORTÃO do rolling update, e contêiner que não fica saudável é
// revertido.
//
// Medido contra o servidor dedicado:
//
//   [entrypoint] StarGuard subindo em 0.0.0.0:3003
//   ✓ Ready in 307ms                                    <- o processo SUBIU
//   worker.loop.failed … Connection terminated due to connection timeout
//   Attempt 1..5 of 5 | curl: (22) … returned error: 503
//   New container is not healthy, rolling back to the old container.
//
// O processo estava de pé e servindo HTTP; quem respondeu 503 foi ele mesmo,
// dizendo corretamente "não alcanço o Postgres". Reverter não conserta nada — o
// contêiner velho tem o mesmo problema, porque o problema não está na imagem —
// e PRENDE: enquanto o banco estiver fora, nenhum deploy entra, nem o que
// conserta a configuração.
//
// O mesmo laço fecha em servidor novo com o banco de pé: schema não migrado ⇒
// `ok: false` ⇒ 503 ⇒ o primeiro deploy nunca sobe.
//
// Ver AUDITORIA.md#BUG-30 e DEPLOY.md.
// ============================================================
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Tudo que a prontidão consulta é substituído por algo que NUNCA responde.
//
// É o ponto do teste, e não zelo de isolamento: se a vivacidade tocasse em
// qualquer um destes, ela penduraria — e um healthcheck pendurado é
// exatamente o que ela existe para não ser. Um mock que resolve rápido
// deixaria passar uma sonda que consulta o banco.
vi.mock("@/lib/schema-check", () => ({
  checkSchema: () => new Promise(() => {}),
  schemaMessage: () => "",
  MIGRATE_HINT: "",
  EXPECTED_MIGRATIONS: 9,
}));
vi.mock("@starguard/core/binaries", () => ({
  checkBinaries: () => new Promise(() => {}),
}));
vi.mock("@/lib/scan-jobs", () => ({
  jobsAtivos: () => {
    throw new Error("a vivacidade não pode consultar a fila");
  },
  recolherAbandonados: () => {
    throw new Error("a vivacidade não pode recolher jobs");
  },
  totalDeJobs: () => {
    throw new Error("a vivacidade não pode consultar a fila");
  },
}));

const { GET } = await import("@/app/api/health/route");

function pedido(url: string): Request {
  return new Request(url);
}

describe("GET /api/health?probe=live — a sonda que destrava o deploy", () => {
  it("responde 200 com o banco INALCANÇÁVEL — era o 503 que revertia o deploy", async () => {
    const res = await GET(pedido("http://localhost/api/health?probe=live"));

    expect(res.status).toBe(200);
  });

  it("não espera pelo banco: responde mesmo com as checagens penduradas", async () => {
    // Sem prazo, sem `Promise.race`, sem nada: se este teste terminar, é porque
    // a sonda não entrou em nenhum dos caminhos mockados acima (todos travam ou
    // lançam). O prazo de 8 s da rota não é usado aqui — e não deve ser.
    const res = await GET(pedido("http://localhost/api/health?probe=live"));

    expect(await res.json()).toEqual({ status: "live" });
  });

  it("`live` não afirma nada sobre o banco — quem responde isso é a prontidão", async () => {
    // Uma sonda de vivacidade que devolvesse `db: "ok"` seria pior que o 503 que
    // ela substitui: diria que está tudo bem sem ter olhado. Ela responde uma
    // coisa só, e é a única que sabe.
    const corpo = (await (await GET(pedido("http://localhost/api/health?probe=live"))).json()) as Record<
      string,
      unknown
    >;

    expect(Object.keys(corpo)).toEqual(["status"]);
  });

  it("qualquer outro valor de `probe` cai na PRONTIDÃO — não é porta dos fundos", async () => {
    // `?probe=qualquercoisa` não pode virar um jeito de pular a checagem. Só o
    // literal `live` desvia; o resto segue o caminho normal (que, com os mocks
    // acima, lança ao tocar na fila).
    await expect(GET(pedido("http://localhost/api/health?probe=sim"))).rejects.toThrow();
  });
});

describe("Dockerfile: o HEALTHCHECK aponta para a vivacidade", () => {
  const dockerfile = readFileSync(join(import.meta.dirname, "..", "Dockerfile"), "utf8");
  // A INSTRUÇÃO, não a palavra: o cabeçalho acima dela explica a decisão e
  // repete "HEALTHCHECK" várias vezes. Início de linha + as continuações de
  // barra invertida é o que delimita a diretiva de verdade.
  const linha = dockerfile.match(/^HEALTHCHECK(?:[^\n]*\\\r?\n)*[^\n]*/m)?.[0] ?? "";

  it("usa `?probe=live`", () => {
    // Este é o acoplamento que nenhum outro teste alcança: a rota pode estar
    // perfeita e o deploy continuar revertendo, porque o portão do rolling
    // update é uma linha de um arquivo de build.
    expect(linha).toContain("/api/health?probe=live");
  });

  it("continua usando `$PORT`, e não um número fixo", () => {
    expect(linha).toMatch(/\$\{PORT\}/);
  });
});
