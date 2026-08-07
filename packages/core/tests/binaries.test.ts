// ============================================================
// Sondagem de binário: "não respondeu" NÃO é "não está instalado".
//
// Este é o defeito que apagou a análise do painel, e ele se alimentava sozinho.
//
// Medido nesta máquina (16 núcleos), com um scan real em andamento — a carga
// que o PRÓPRIO StarGuard cria, porque `runSast` abre `--jobs <núcleos>`
// processos e o `runSca` roda em paralelo com ele:
//
//   `opengrep --version` ocioso  →  1,8 s
//   o mesmo, com o scan rodando  →  5,1 s, MORTO pelo teto de 5 s
//   `trivy --version`   ocioso   →  0,1 s
//   o mesmo, com o scan rodando  →  5,1 s, MORTO pelo teto de 5 s
//
// O ciclo:
//
//   1. a análise começa e satura a máquina;
//   2. qualquer sondagem daquela janela estoura o teto e responde "ausente";
//   3. a resposta ficava no cache por 60 s;
//   4. a análise SEGUINTE montava o plano com esse cache e tirava o `sast` e o
//      `sca` dela — com os dois binários instalados, parados, no disco.
//
// O relatório saía sem scanner nenhum e a tela dizia "o executável não foi
// encontrado neste computador": uma afirmação FALSA sobre a máquina de quem
// lê, no lugar mais caro possível para uma mentira dessas. É o UX-15.
//
// O segundo caso vem de uma medição no mesmo dia: um `next dev` com uma hora de
// vida passou a devolver `exit 3221225794` (0xC0000142, STATUS_DLL_INIT_FAILED)
// ao criar QUALQUER processo filho, enquanto um servidor recém-subido, na mesma
// máquina, no mesmo minuto, com o mesmo `.env.local`, executava os dois
// binários sem hesitar. Também não é ausência — e também não é carga: é o
// processo pai que não cria mais filhos, e a saída é reiniciar o servidor.
//
// Ver AUDITORIA.md#BUG-26.
// ============================================================
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";

// O `execFile` é substituído ANTES de `binaries.ts` ser carregado: o módulo
// faz `promisify(execFile)` na avaliação, então trocar depois não teria efeito.
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

// O `execFile` de verdade traz `promisify.custom`, e é ele que faz o `await`
// resolver `{stdout, stderr}` em vez de só `stdout`. Sem reproduzir isso aqui,
// o `const { stdout } = await ...` de `binaries.ts` desestrutura uma STRING,
// `stdout` vem `undefined` e TODA sondagem falha — o mock testaria o caminho
// de erro o tempo inteiro e os testes passariam pelo motivo errado.
const { promisify } = await import("node:util");
(execFileMock as unknown as Record<symbol, unknown>)[promisify.custom] = (
  bin: string,
  args: string[],
  opts: unknown
) =>
  new Promise((resolve, reject) => {
    execFileMock(bin, args, opts, (erro: unknown, stdout: string, stderr: string) =>
      erro ? reject(erro) : resolve({ stdout, stderr })
    );
  });

const { probeBinary, pareceInstalado, clearProbeCache, checkBinaries } = await import(
  "../src/binaries"
);
// Carregados AQUI, e não dentro dos testes: o grafo do `sast` arrasta o SDK de
// agente, e pagar essa importação dentro de um `it` estoura o teto de 5 s
// quando a suíte inteira roda — a falha vira "teste lento", que não é o que se
// está medindo.
const { sastAnalyzer } = await import("../src/analyzers/sast");
const { scaAnalyzer } = await import("../src/analyzers/sca");

type Retorno = (erro: unknown, stdout: string, stderr: string) => void;

/** Um `execFile` de callback, que é o que o `promisify` espera encontrar. */
function responder(fn: (bin: string) => { erro?: unknown; stdout?: string }) {
  execFileMock.mockImplementation((bin: string, _args: unknown, _opts: unknown, cb: Retorno) => {
    const r = fn(bin);
    if (r.erro) cb(r.erro, "", "");
    else cb(null, r.stdout ?? "", "");
  });
}

/** O erro que o Node produz quando o teto mata o processo. */
function erroDeTeto(bin: string) {
  return Object.assign(new Error(`Command failed: ${bin} --version\n`), {
    killed: true,
    code: null,
  });
}

/** O erro que o Node produz quando o executável não existe. */
function erroEnoent(bin: string) {
  return Object.assign(new Error(`spawn ${bin} ENOENT`), { code: "ENOENT" });
}

/** O que o Windows devolve quando o carregador recusa o processo. */
function erroDllInit(bin: string) {
  return Object.assign(new Error(`Command failed: ${bin} --version\n`), {
    code: 3221225794, // 0xC0000142
    killed: false,
  });
}

beforeEach(() => {
  clearProbeCache();
  execFileMock.mockReset();
});

describe("sondagem: teto estourado não é ausência (BUG-26)", () => {
  it("processo morto pelo teto responde «busy», NUNCA «missing»", async () => {
    responder((bin) => ({ erro: erroDeTeto(bin) }));

    const r = await probeBinary("opengrep");

    // Antes da correção isto era `{ present: false }` puro, e o analisador
    // saía do plano por causa dele.
    expect(r.present).toBe(false);
    expect(r.reason).toBe("busy");
  });

  it("«busy» mantém o analisador no plano — é o que impedia a análise seguinte", async () => {
    responder((bin) => ({ erro: erroDeTeto(bin) }));
    expect(pareceInstalado(await probeBinary("opengrep"))).toBe(true);
  });

  it("ENOENT continua sendo ausência de verdade", async () => {
    responder((bin) => ({ erro: erroEnoent(bin) }));

    const r = await probeBinary("naoexiste");
    expect(r.reason).toBe("missing");
    // Este é o caso em que tirar do plano é a coisa CERTA a fazer.
    expect(pareceInstalado(r)).toBe(false);
  });
});

describe("resposta boa não é apagada por desconhecimento", () => {
  it("depois de uma versão conhecida, um teto estourado NÃO vira «ausente»", async () => {
    // 1ª sondagem: máquina livre.
    responder(() => ({ stdout: "1.25.0\n" }));
    const bom = await probeBinary("opengrep");
    expect(bom).toMatchObject({ present: true, version: "1.25.0" });

    // O cache de resposta boa vale 60 s; avança além dele para forçar nova
    // sondagem — agora com a máquina no chão.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      responder((bin) => ({ erro: erroDeTeto(bin) }));

      const depois = await probeBinary("opengrep");

      // Binário não se desinstala no meio de um scan.
      expect(depois.present).toBe(true);
      expect(depois.version).toBe("1.25.0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("um «não sei» vale segundos, não o minuto inteiro", async () => {
    responder((bin) => ({ erro: erroDeTeto(bin) }));
    expect((await probeBinary("trivy")).reason).toBe("busy");
    const sondagensAteAqui = execFileMock.mock.calls.length;

    vi.useFakeTimers();
    try {
      // Passado o TTL curto, a máquina já esvaziou e a resposta boa volta.
      vi.setSystemTime(Date.now() + 6_000);
      responder(() => ({ stdout: "Version: 0.72.0\n" }));

      const r = await probeBinary("trivy");
      expect(r).toMatchObject({ present: true, version: "Version: 0.72.0" });
      expect(execFileMock.mock.calls.length).toBeGreaterThan(sondagensAteAqui);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resposta boa é servida do cache, sem abrir processo por chamada", async () => {
    responder(() => ({ stdout: "1.25.0\n" }));
    await probeBinary("opengrep");
    await probeBinary("opengrep");
    await probeBinary("opengrep");
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});

describe("o Windows recusando INICIAR o processo (0xC0000142)", () => {
  it("é «spawn_failed», e não «não encontrado neste computador»", async () => {
    responder((bin) => ({ erro: erroDllInit(bin) }));

    const r = await probeBinary("C:\\Users\\Nelson\\bin\\opengrep.exe");

    expect(r.reason).toBe("spawn_failed");
    // O código entra no detalhe: sem ele, `Command failed: …` não diz nada, e
    // foi exatamente essa falta que fez o diagnóstico levar uma hora.
    expect(r.detail).toContain("0xC0000142");
  });

  it("NÃO é tratado como carga: não adianta tentar, o processo não cria filhos", async () => {
    responder((bin) => ({ erro: erroDllInit(bin) }));
    expect(pareceInstalado(await probeBinary("opengrep"))).toBe(false);
  });
});

// ------------------------------------------------------------
// O caminho NEGATIVO que a auditoria exige: o que o plano recusa.
//
// Estes dois analisadores são o produto inteiro. Se o `probe` deles tirar o
// `sast` e o `sca` do plano por causa de uma sondagem que estourou o teto, a
// análise sai vazia — e vazia com cara de limpa.
// ------------------------------------------------------------
describe("o plano não perde o scanner por uma sondagem inconclusiva", () => {
  // `SAST_RULES` posto tira o `no_rules` do caminho: aqui o que se mede é a
  // decisão sobre o BINÁRIO, não sobre o ruleset.
  const antes = process.env.SAST_RULES;
  beforeEach(() => {
    process.env.SAST_RULES = "/regras/quaisquer";
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.SAST_RULES;
    else process.env.SAST_RULES = antes;
  });

  it("SAST continua no plano com a máquina ocupada", async () => {
    responder((bin) => ({ erro: erroDeTeto(bin) }));

    // Era aqui que a análise seguinte perdia o scanner.
    expect(await sastAnalyzer.probe({ hasWorkspace: true, hasInput: () => true })).toMatchObject({
      ok: true,
    });
  });

  it("SCA continua no plano com a máquina ocupada", async () => {
    responder((bin) => ({ erro: erroDeTeto(bin) }));

    expect(await scaAnalyzer.probe({ hasWorkspace: true, hasInput: () => true })).toMatchObject({
      ok: true,
    });
  });

  it("ausência de verdade continua tirando do plano, com o motivo certo", async () => {
    responder((bin) => ({ erro: erroEnoent(bin) }));

    expect(await sastAnalyzer.probe({ hasWorkspace: true, hasInput: () => true })).toMatchObject({
      ok: false,
      reason: "binary_missing",
    });
  });

  it("0xC0000142 sai do plano dizendo «reinicie», não «instale»", async () => {
    responder((bin) => ({ erro: erroDllInit(bin) }));

    expect(await sastAnalyzer.probe({ hasWorkspace: true, hasInput: () => true })).toMatchObject({
      ok: false,
      reason: "spawn_failed",
    });
  });
});

describe("checkBinaries (o que o /api/health publica)", () => {
  it("carrega o motivo, para o health não acusar a máquina de quem opera", async () => {
    responder((bin) => ({ erro: erroDeTeto(bin) }));

    const status = await checkBinaries();
    const sast = status.find((b) => b.name === "sast")!;

    expect(sast.present).toBe(false);
    // Sem esta distinção o health mandava a pessoa reinstalar o que já estava
    // instalado e funcionando.
    expect(sast.reason).toBe("busy");
  });
});
