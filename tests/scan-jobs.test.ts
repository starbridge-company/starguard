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
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

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

// ------------------------------------------------------------
// NENHUM teste deste arquivo gera processo de scanner.
// ------------------------------------------------------------
//
// O que se afirma aqui é o ciclo de vida do JOB — fila, cancelamento, abandono,
// limpeza do temporário. Nada disso depende de haver opengrep na máquina, e
// depender disso saía caro: com o ruleset detectado no disco, um único scan de
// verdade leva ~40 s, e o teste passava a medir a carga da máquina.
//
// `ENGINES` é lido UMA vez, na carga do módulo `config.ts` do núcleo — por isso
// a variável é posta aqui em cima, antes de qualquer import do núcleo
// acontecer. Com os engines desligados, `runSast`/`runSca` devolvem `[]` na
// primeira linha e o job segue o mesmo caminho de sempre até o `finally`.
process.env.SAST_ENGINE = "none";
process.env.SCA_ENGINE = "none";

const ALICE = "user-alice";
const BOB = "user-bob";

/** Um job qualquer. Com os engines desligados, ele termina sem tocar em disco. */
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

/**
 * Carrega o grafo do núcleo ANTES de cronometrar qualquer coisa.
 *
 * `executar` importa os analisadores por `await import(...)`, e esse grafo é
 * grande — config, parsers, enrich, catálogo dos três idiomas, corretores. Na
 * suíte cheia, com dezenas de arquivos disputando a máquina, a PRIMEIRA
 * resolução desse import passa de dez segundos, e o teste que espera o job
 * terminar falhava medindo o compilador em vez do código.
 *
 * Aquecer aqui não afrouxa nada: o que se afirma continua sendo o comportamento
 * do job. Só se tira do relógio o custo que não é dele.
 */
beforeAll(async () => {
  await Promise.all([
    import("@starguard/core/analyzers/sast"),
    import("@starguard/core/analyzers/sca"),
    import("@starguard/core/enrich"),
    import("@starguard/core/redact"),
  ]);
}, 120_000);

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

  it("o prazo de abandono é MAIOR que o silêncio que o cliente tolera", async () => {
    // Aqui estava a contradição que produzia
    // "O scan foi perdido pelo servidor (ele pode ter reiniciado)" sem o
    // servidor ter reiniciado nada.
    //
    // O cliente foi escrito para NÃO jogar fora um scan por causa de consultas
    // perdidas: ele tolera `SILENCIO_TOLERADO_MS` (5 consultas × 20 s = 100 s)
    // antes de desistir. O servidor recolhia com 60 s, escritos à mão noutro
    // pacote. Ou seja: a tolerância do cliente era código morto — o servidor
    // chegava primeiro, SEMPRE, e matava um scan que estava indo bem.
    //
    // Duas constantes em dois pacotes, ninguém as leu lado a lado. É o mesmo
    // defeito das chaves de `MSG_ESCANEANDO_LOCAL`, e o mesmo conserto.
    const { SILENCIO_TOLERADO_MS } = await import("@starguard/core/scan-transport");

    const job = jobFalso();
    // Silêncio dentro do que o cliente aguenta: uma janela de rede fechada, uma
    // máquina que suspendeu por um minuto e meio.
    job.visitadoEm = Date.now() - SILENCIO_TOLERADO_MS;

    expect(recolherAbandonados().abandonados).toBe(0);
    expect(job.abortar.signal.aborted).toBe(false);
    expect(jobsAtivos()).toBe(1);
  });

  it("passado o prazo de verdade, recolhe — a rede de segurança continua existindo", () => {
    // O conserto não pode virar "nunca recolhe": um job que ninguém mais quer
    // segura a vaga do scanner, que é o recurso escasso da caixa.
    const job = jobFalso();
    job.visitadoEm = Date.now() - 60 * 60_000;
    expect(recolherAbandonados().abandonados).toBe(1);
    expect(job.abortar.signal.aborted).toBe(true);
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

  it("derruba o ABANDONADO, e não o mais velho que alguém está acompanhando", () => {
    // O caso real, e o que fazia a extensão dizer "O scan foi perdido pelo
    // servidor": o envio do `sast` estoura o teto de 120 s numa conexão
    // doméstica, o cliente REPETE o POST, e o primeiro envio já tinha criado um
    // job deste lado. Com o `sca`, são três. Pelo critério de idade, o que
    // morria era o mais velho — que é justamente o que o cliente está
    // consultando de segundo em segundo. A pessoa perdia o scan por causa de
    // uma retentativa do próprio cliente dela.
    const acompanhado = jobFalso(ALICE, "sast");
    const orfao = jobFalso(ALICE, "sast");

    // `acompanhado` é o mais VELHO e o mais RECENTEMENTE consultado. O órfão do
    // envio repetido nunca é consultado por ninguém.
    acompanhado.criadoEm = 1;
    orfao.criadoEm = 2;
    orfao.visitadoEm = 1;
    tocarJob(acompanhado);

    jobFalso(ALICE, "sca");

    expect(orfao.abortar.signal.aborted).toBe(true);
    expect(acharJob(orfao.id, ALICE)).toBeUndefined();
    // A prova: quem está sendo acompanhado sobrevive.
    expect(acharJob(acompanhado.id, ALICE)?.id).toBe(acompanhado.id);
    expect(acompanhado.abortar.signal.aborted).toBe(false);
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

describe("o pacote recebido não fica em memória depois de aterrissar", () => {
  it("cada conteúdo é solto assim que chega ao disco", async () => {
    // O corpo de um envio de SAST chega como 800 strings somando até 8 MB — que
    // no V8 são ~16 MB em UTF-16 — e ficavam TODAS vivas até o laço acabar, ao
    // lado da cópia recém-escrita no disco. O pico era o pacote inteiro duas
    // vezes, com dois envios podendo coincidir.
    const { rm } = await import("node:fs/promises");
    const entrada = [
      { rel: "a.ts", content: "const a = 1;" },
      { rel: "sub/b.ts", content: "const b = 2;" },
    ];
    const { dir, escritos } = await prepararDiretorio(entrada);
    try {
      expect(escritos).toBe(2);
      // A prova: o array de entrada não segura mais nada.
      expect(entrada.map((f) => f.content)).toEqual(["", ""]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a rota larga o `corpo.files` antes de mandar gravar", async () => {
    // Sem isto, o de cima é teatro: `corpo.files` e `aprovados` apontam para as
    // MESMAS strings, e o coletor não recupera nada enquanto uma das duas
    // referências existir. `corpo` vive até o `return` da rota.
    const fonte = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/scan/route.ts", "utf8")
    );
    const larga = fonte.indexOf("corpo.files = undefined");
    const grava = fonte.indexOf("await prepararDiretorio(aprovados)");
    expect(larga).toBeGreaterThan(0);
    expect(larga).toBeLessThan(grava);
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

// ============================================================
// Defeitos do ENDPOINT, encontrados na segunda passada.
//
// Depois de o job funcionar, sobrou reler a rota com olhos de quem procura o
// que ainda pode travar ou vazar. Estes quatro estavam lá.
// ============================================================

describe("o teto de tamanho tem que valer ANTES do corpo ser lido", () => {
  it("o `content-length` é conferido antes do parse", async () => {
    // `MAX_BYTES` era checado DEPOIS de `readJson`, ou seja, depois de o JSON
    // inteiro já estar bufferizado e parseado na memória. Numa instância de
    // 512 MB isso torna o teto decorativo: um cliente autenticado que mande
    // 300 MB derruba o processo antes da primeira linha de validação — e leva
    // junto as requisições de todo mundo, que é o modo de falha do ARQ-15.
    const fonte = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/scan/route.ts", "utf8")
    );
    const antes = fonte.indexOf('req.headers.get("content-length")');
    const depois = fonte.indexOf("await readJsonWithLimit(req");
    expect(antes).toBeGreaterThan(0);
    expect(antes).toBeLessThan(depois);
  });

  it("o teto continua valendo sem content-length e as referências são soltas", async () => {
    const fonte = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/scan/route.ts", "utf8")
    );
    expect(fonte).toContain("readJsonWithLimit(req, MAX_BYTES * 2)");
    expect(fonte).toContain("files.length = 0");
    expect(fonte).toContain('Buffer.byteLength(f.content, "utf8")');
  });

  // O guarda de caminho (`caminhoSeguro`) tem suíte própria em
  // `tests/scan-remoto.test.ts`, que é quase toda caminho negativo. Repeti-lo
  // aqui custava 5 s por importar a cadeia inteira do Next e não afirmava nada
  // que o outro arquivo já não afirme melhor.
});

describe("a consulta não pode matar o job que ela vem buscar", () => {
  it("o `tocarJob` acontece ANTES do `recolherAbandonados` no GET", async () => {
    // A ordem era a inversa, e nela uma consulta que chegasse um segundo depois
    // do prazo **recolhia o próprio job que vinha buscar**: a varredura via o
    // silêncio, cancelava, e o `acharJob` logo abaixo devolvia 404. O cliente
    // anunciava "O scan foi perdido pelo servidor (ele pode ter reiniciado)" —
    // falso duas vezes: o servidor não reiniciou, e quem perdeu o scan foi a
    // requisição que era a PROVA de que alguém ainda o queria.
    //
    // Asserção sobre a fonte, como a do `content-length` acima, porque o que
    // está errado é a ORDEM — e ordem não quebra tipo, lint nem teste de
    // unidade das funções envolvidas, que estão as duas corretas.
    const fonte = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/scan/route.ts", "utf8")
    );
    const get = fonte.indexOf("export async function GET");
    expect(get).toBeGreaterThan(0);
    const trecho = fonte.slice(get);
    // A chamada, e não a menção: as duas aparecem no comentário que explica o
    // conserto, e um `indexOf` solto casaria com ele em vez de com o código.
    const toca = trecho.indexOf("\n  if (job) tocarJob(job);");
    const recolhe = trecho.indexOf("\n  recolherAbandonados();");
    expect(toca).toBeGreaterThan(0);
    expect(recolhe).toBeGreaterThan(0);
    expect(toca).toBeLessThan(recolhe);
  });
});

describe("nenhum temporário fica para trás", () => {
  it("o job apaga o diretório ao terminar, com qualquer desfecho", async () => {
    const { mkdtemp, writeFile, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "sg-scan-teste-"));
    await writeFile(join(dir, "a.ts"), "const a = 1;", "utf8");

    // O contrato aqui é o `finally`: **o temporário some quando o job termina**.
    // Ele é o mesmo nos dois desfechos — a saída por erro está coberta pelos
    // testes de cancelamento acima, que afirmam `job.dir === null`.
    {
      const job = criarJob({
        userId: ALICE,
        analyzer: "sast",
        locale: "pt-BR",
        dir,
        arquivos: 1,
        bytes: 12,
      });

      // `terminadoEm` é a ÚLTIMA coisa que o job escreve, depois de o disco já
      // estar limpo — esperar por ele é esperar pelo fim de verdade. Um laço com
      // número fixo de voltas passava sozinho e falhava na suíte cheia, onde a
      // máquina está disputada: a espera precisa ser por condição, não por
      // contagem.
      await vi.waitFor(() => expect(job.terminadoEm).toBeGreaterThan(0), {
        timeout: 10_000,
        interval: 20,
      });
      expect(job.status).toBe("done");
      // A prova: o diretório com código de outra pessoa não sobrevive ao scan.
      await expect(access(dir)).rejects.toThrow();
      expect(job.dir).toBeNull();
      await import("node:fs/promises").then((fs) =>
        fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      );
    }
  }, 15_000);

  it("o job larga a referência do diretório junto", () => {
    // Guardar o caminho depois de apagá-lo convidaria uma segunda remoção a
    // acertar um diretório que já pertence a outro scan.
    const job = jobFalso();
    cancelarJob(job);
    expect(job.dir).toBeNull();
  });
});
