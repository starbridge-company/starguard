// ============================================================
// A fila do servidor tem que ESVAZIAR — AUDITORIA.md#ARQ-16.
//
// O relato que originou este arquivo cabe numa frase: "não consigo rodar em
// dois projetos ao mesmo tempo, mesmo com a fila, ela aparentemente nunca é
// limpa".
//
// A fila estava certa. O que não existia era saída dela.
//
// A rota escaneava dentro da requisição. Quando o cliente desistia no teto de
// tempo dele, o `fetch` era abortado — e aqui NADA acontecia: ninguém olhava o
// `req.signal`, o opengrep seguia rodando e a vaga seguia ocupada. A tentativa
// seguinte criava um segundo scan, tão órfão quanto o primeiro. Em três
// tentativas a fila estava cheia de trabalho que ninguém esperava, e a partir
// dali toda requisição — de qualquer pessoa, de qualquer projeto — levava 429.
//
// Os testes abaixo são quase todos sobre SAIR da fila: por cancelamento, por
// abandono e por teto por pessoa. O caso feliz é o menor deles.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// O `audit` grava no Postgres, que não existe nesta suíte. O que interessa aqui
// é a máquina de estados do job, não o registro — e um mock deixa isso explícito
// em vez de depender de uma rejeição silenciosamente engolida.
vi.mock("@/lib/auth", () => ({ audit: vi.fn() }));

import {
  acharJob,
  cancelarJob,
  criarJob,
  jobsAtivos,
  limparJobs,
  posicaoNaFila,
  prepararDiretorio,
  recolherAbandonados,
  tocarJob,
} from "@/lib/scan-jobs";

const ALICE = "user-alice";
const BOB = "user-bob";

/**
 * Um job que não roda scanner nenhum.
 *
 * `dir` aponta para um diretório que não existe: `runSast` falha rápido, o job
 * termina em `error` e nada de pesado é executado. O que estes testes medem é a
 * CONTABILIDADE da fila, e ela não depende de haver opengrep na máquina.
 */
function jobFalso(userId = ALICE, analyzer: "sast" | "sca" = "sast") {
  return criarJob({
    userId,
    analyzer,
    locale: "pt-BR",
    dir: "/caminho/que/nao/existe/sg-teste",
    arquivos: 1,
    bytes: 10,
  });
}

beforeEach(() => limparJobs());
afterEach(() => limparJobs());

describe("cancelar TIRA da fila (era o que faltava)", () => {
  it("um job cancelado deixa de contar como ativo", () => {
    const job = jobFalso();
    expect(jobsAtivos()).toBe(1);

    cancelarJob(job);

    // Este é o teste que falha no desenho antigo: lá não havia como cancelar,
    // e o scan abandonado continuava ocupando a instância até terminar sozinho.
    expect(jobsAtivos()).toBe(0);
    expect(acharJob(job.id, ALICE)).toBeUndefined();
  });

  it("cancelar avisa o processo nativo, e não só a contabilidade", () => {
    // O `signal` é o que `runSast`/`runSca` passam ao `execFile`. Sem ele,
    // cancelar parava de ESPERAR pelo opengrep — o opengrep seguia rodando.
    const job = jobFalso();
    expect(job.abortar.signal.aborted).toBe(false);
    cancelarJob(job);
    expect(job.abortar.signal.aborted).toBe(true);
  });

  it("cancelar duas vezes não é erro", () => {
    // O `DELETE` do cliente e o recolhimento por abandono chegam juntos mais
    // vezes do que se imagina.
    const job = jobFalso();
    cancelarJob(job);
    expect(() => cancelarJob(job)).not.toThrow();
  });

  it("o job some do mapa NA HORA, não quando o disco terminar de ser limpo", () => {
    // Sem isto o cancelamento era `async` e a remoção do mapa ficava pendurada
    // num `await rm()`. Quem cancelava e contava a fila na linha seguinte ainda
    // via o job cancelado — e o teto por pessoa deixava passar um a mais.
    const job = jobFalso();
    cancelarJob(job);
    expect(acharJob(job.id, ALICE)).toBeUndefined();
    expect(jobsAtivos()).toBe(0);
  });
});

describe("abandono: quem não pergunta mais é recolhido", () => {
  it("um job sem consulta há tempo demais é cancelado e some", () => {
    const job = jobFalso();
    // Uma hora sem notícia: janela fechada, máquina suspensa, Wi-Fi caído.
    job.visitadoEm = Date.now() - 60 * 60_000;

    const { abandonados } = recolherAbandonados();

    expect(abandonados).toBe(1);
    expect(job.abortar.signal.aborted).toBe(true);
    expect(jobsAtivos()).toBe(0);
  });

  it("consultar SEGURA o job — o polling é o batimento cardíaco", () => {
    const job = jobFalso();
    job.visitadoEm = Date.now() - 60 * 60_000;

    // É exatamente o que o `GET /api/scan?job=` faz a cada consulta. Sem esta
    // linha, o recolhimento mataria um scan que está sendo acompanhado — o
    // defeito oposto ao que ele conserta.
    tocarJob(job);
    const { abandonados } = recolherAbandonados();

    expect(abandonados).toBe(0);
    expect(jobsAtivos()).toBe(1);
  });

  it("recolher não toca em quem acabou de chegar", () => {
    jobFalso();
    jobFalso(BOB);
    expect(recolherAbandonados().abandonados).toBe(0);
    expect(jobsAtivos()).toBe(2);
  });
});

describe("teto por pessoa: o resto de uma janela fechada não bloqueia a próxima", () => {
  it("o terceiro job da mesma pessoa derruba o mais velho", () => {
    // Dois é o que uma análise pede: `sast` e `sca`. Um terceiro pedido do
    // mesmo dono é quase sempre sobra de uma janela que já foi fechada.
    const primeiro = jobFalso(ALICE, "sast");
    jobFalso(ALICE, "sca");
    jobFalso(ALICE, "sast");

    expect(primeiro.abortar.signal.aborted).toBe(true);
    expect(acharJob(primeiro.id, ALICE)).toBeUndefined();
    expect(jobsAtivos()).toBe(2);
  });

  it("o teto é POR PESSOA — dois projetos de donos diferentes convivem", () => {
    // "Não consigo rodar em dois projetos ao mesmo tempo" tinha esta metade:
    // um teto global recusaria o segundo. Aqui cada um tem o seu.
    const a1 = jobFalso(ALICE, "sast");
    const b1 = jobFalso(BOB, "sast");
    expect(a1.abortar.signal.aborted).toBe(false);
    expect(b1.abortar.signal.aborted).toBe(false);
    expect(jobsAtivos()).toBe(2);
  });
});

describe("um job é de quem o criou", () => {
  it("o dono encontra o seu", () => {
    const job = jobFalso(ALICE);
    expect(acharJob(job.id, ALICE)?.id).toBe(job.id);
  });

  it("outra pessoa não encontra — nem para saber que existe", () => {
    // Confirmar a existência de um job alheio já é informação a mais: quem não
    // é dono recebe a mesma resposta de quem chutou um id.
    const job = jobFalso(ALICE);
    expect(acharJob(job.id, BOB)).toBeUndefined();
  });

  it("id inventado não encontra nada", () => {
    jobFalso(ALICE);
    expect(acharJob("id-que-nao-existe", ALICE)).toBeUndefined();
  });
});

describe("posição na fila: a espera vira previsão", () => {
  it("quem chegou primeiro é o primeiro da fila", () => {
    const a = jobFalso(ALICE);
    const b = jobFalso(BOB);
    // Só vale enquanto estão em `queued`; a execução começa no microtask
    // seguinte, então fixamos o estado para medir a ORDEM, que é o que a
    // função promete.
    a.status = "queued";
    b.status = "queued";
    a.criadoEm = 1;
    b.criadoEm = 2;

    expect(posicaoNaFila(a.id)).toBe(1);
    expect(posicaoNaFila(b.id)).toBe(2);
  });

  it("quem já está rodando não tem posição", () => {
    const a = jobFalso();
    a.status = "running";
    expect(posicaoNaFila(a.id)).toBe(0);
  });
});

describe("os arquivos recebidos", () => {
  it("são gravados dentro do temporário e apagados no fim", async () => {
    const { readFile, rm } = await import("node:fs/promises");
    const { dir, escritos } = await prepararDiretorio([
      { rel: "src/app.ts", content: "const a = 1;" },
      { rel: "package.json", content: "{}" },
    ]);
    try {
      expect(escritos).toBe(2);
      expect(await readFile(`${dir}/src/app.ts`, "utf8")).toBe("const a = 1;");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
