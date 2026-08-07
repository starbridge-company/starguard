// ============================================================
// Quanto da máquina é nosso — AUDITORIA.md#ARQ-15.
//
// Este arquivo existe por causa de um servidor que MORRIA. `os.cpus()` dentro
// de um contêiner devolve os núcleos do hospedeiro, e o SAST usava esse número
// para abrir processos: oito processos do opengrep numa instância de meia CPU
// e 512 MB. A memória estourava, a instância caía no meio da requisição, e o
// editor recebia a página de erro da borda — "403" no analisador que morreu e
// "502" no que rodava em paralelo, nenhum dos dois com corpo JSON.
//
// Nada disso quebrava teste, tipo ou build: só aparecia sob carga real, no
// contêiner de verdade. A aritmética está isolada aqui justamente para poder
// ser conferida sem um.
// ============================================================
import { describe, it, expect } from "vitest";
import {
  cpusDeCgroupV1,
  cpusDeCgroupV2,
  memoriaDeCgroup,
  modoEconomicoParaRecursos,
  concorrenciaDaAnaliseParaRecursos,
  memoriaDoTrivyParaRecursos,
  processosPara,
  processosDeScan,
  scanSlotsParaRecursos,
  sastJobsParaRecursos,
  sastMaxMemoryParaRecursos,
} from "../src/container";

describe("fatia de CPU no cgroup v2", () => {
  it("meia CPU é meia CPU", () => {
    // É o valor do plano `starter` do Render, que foi onde doeu.
    expect(cpusDeCgroupV2("50000 100000")).toBe(0.5);
  });

  it("duas CPUs", () => {
    expect(cpusDeCgroupV2("200000 100000")).toBe(2);
  });

  it("«max» é ausência de limite, não limite zero", () => {
    expect(cpusDeCgroupV2("max 100000")).toBeNull();
  });

  it("arquivo ausente não vira zero", () => {
    // Fora de contêiner o arquivo não existe. Devolver 0 faria o chamador
    // concluir "cabe zero processo" e não rodar nada.
    expect(cpusDeCgroupV2(null)).toBeNull();
    expect(cpusDeCgroupV2("")).toBeNull();
  });

  it("conteúdo estranho não derruba a leitura", () => {
    expect(cpusDeCgroupV2("lixo")).toBeNull();
    expect(cpusDeCgroupV2("100000 0")).toBeNull();
  });
});

describe("fatia de CPU no cgroup v1", () => {
  it("cota dividida pelo período", () => {
    expect(cpusDeCgroupV1("50000", "100000")).toBe(0.5);
  });

  it("-1 é «sem limite» no v1", () => {
    expect(cpusDeCgroupV1("-1", "100000")).toBeNull();
  });

  it("arquivos ausentes", () => {
    expect(cpusDeCgroupV1(null, null)).toBeNull();
  });
});

describe("quantos processos cabem", () => {
  it("meia CPU comporta UM processo, não zero", () => {
    // Arredondar para baixo sem piso devolveria 0 — e zero processo não
    // analisa nada.
    expect(processosPara(0.5, 8)).toBe(1);
  });

  it("uma CPU e meia comporta um", () => {
    expect(processosPara(1.5, 8)).toBe(1);
  });

  it("quatro CPUs comportam quatro", () => {
    expect(processosPara(4, 16)).toBe(4);
  });

  it("sem limite declarado, vale a máquina — o desenvolvimento não fica lento", () => {
    expect(processosPara(null, 8)).toBe(8);
  });

  it("nunca menos de um, nem com hospedeiro zerado", () => {
    expect(processosPara(null, 0)).toBe(1);
  });
});

describe("memória do contêiner", () => {
  it("bytes viram MB", () => {
    expect(memoriaDeCgroup(String(512 * 1024 * 1024))).toBe(512);
  });

  it("«max» é ausência de limite", () => {
    expect(memoriaDeCgroup("max")).toBeNull();
  });

  it("o «sem limite» do v1 é um número absurdo, e não um limite de 8 exabytes", () => {
    expect(memoriaDeCgroup("9223372036854771712")).toBeNull();
  });

  it("ausente é nulo", () => {
    expect(memoriaDeCgroup(null)).toBeNull();
  });
});

describe("modo econômico dos scanners", () => {
  it("512 MB serializa o trabalho em vez de recusá-lo", () => {
    expect(modoEconomicoParaRecursos(512)).toBe(true);
    expect(concorrenciaDaAnaliseParaRecursos(512)).toBe(1);
    expect(memoriaDoTrivyParaRecursos(512)).toBe(192);
  });

  it("cresce gradualmente com a caixa e nunca passa de quatro fases", () => {
    expect(modoEconomicoParaRecursos(1024)).toBe(false);
    expect(concorrenciaDaAnaliseParaRecursos(1536)).toBe(2);
    expect(concorrenciaDaAnaliseParaRecursos(3072)).toBe(3);
    expect(concorrenciaDaAnaliseParaRecursos(8192)).toBe(4);
    expect(memoriaDoTrivyParaRecursos(4096)).toBe(1024);
  });
});

// ------------------------------------------------------------
// Guardar um núcleo para o Node — AUDITORIA.md#BUG-26
// ------------------------------------------------------------
//
// O scanner não é o único morador da caixa: o MESMO processo Node responde
// `/api/status`, `/api/scan?job=…` e o health check enquanto o opengrep roda.
// Com `--jobs` igual a todos os núcleos, o scan tomava a máquina inteira e o
// servidor parava de responder no meio da própria análise — que é como um scan
// lento vira um scan que "travou" para quem está olhando.
describe("processosDeScan — o scanner não pode tomar a caixa inteira", () => {
  it("numa máquina grande, sobra um núcleo para o servidor responder", () => {
    expect(processosDeScan(16)).toBe(15);
    expect(processosDeScan(8)).toBe(7);
    expect(processosDeScan(4)).toBe(3);
  });

  it("na caixa pequena nada é reservado — não há o que dividir", () => {
    // É o caso da produção (meia CPU → 1). Reservar ali deixaria ZERO processo
    // de scanner, que é não analisar nada.
    expect(processosDeScan(1)).toBe(1);
    expect(processosDeScan(2)).toBe(2);
  });

  it("nunca devolve menos de 1, nem com entrada absurda", () => {
    expect(processosDeScan(0)).toBe(1);
    expect(processosDeScan(-3)).toBe(1);
  });
});

describe("orçamento combinado de CPU e memória", () => {
  it("4 GB limitam hosts com muitos núcleos a quatro filhos", () => {
    expect(sastJobsParaRecursos(32, 4096)).toBe(4);
    expect(sastJobsParaRecursos(4, 4096)).toBe(3);
  });

  it("a antiga caixa de 512 MB continua com um único filho", () => {
    expect(sastJobsParaRecursos(8, 512)).toBe(1);
  });

  it("num servidor de 4 GB, um SAST multiprocesso ocupa uma única vaga", () => {
    expect(scanSlotsParaRecursos(4, 3, 4096)).toBe(1);
  });

  it("reduzir SAST_JOBS permite concorrência sem ultrapassar metade da RAM", () => {
    expect(scanSlotsParaRecursos(4, 1, 4096)).toBe(2);
  });

  it("o orçamento de 4 GB deixa metade da caixa fora do Opengrep", () => {
    expect(sastMaxMemoryParaRecursos(4096, 1, 3)).toBe(682);
    expect(sastMaxMemoryParaRecursos(4096, 2, 1)).toBe(1024);
  });

  it("em 512 MB o Opengrep recebe 192 MB e deixa mais de 60% para Node e SO", () => {
    expect(sastMaxMemoryParaRecursos(512, 1, 1)).toBe(192);
  });

  it("nem uma caixa enorme autoriza mais de 1 GB por filho", () => {
    expect(sastMaxMemoryParaRecursos(65_536, 1, 1)).toBe(1024);
  });
});

// ------------------------------------------------------------
// De ONDE veio o número — AUDITORIA.md#ARQ-15
// ------------------------------------------------------------
//
// `/api/health` publicava `slots: 1` e nada mais. Esse `1` tem três origens que
// pedem consertos opostos: cota de CPU no cgroup, `SCAN_SLOTS`/`SAST_JOBS`
// fixados no ambiente (herança do DEPLOY.md escrito para a instância de meia
// CPU), ou uma máquina de um núcleo. Sem a procedência, "por que o scan demora
// tanto no servidor DEDICADO?" não tem como ser respondida de fora — e foi
// exatamente essa a pergunta.
describe("limitesDaCaixa — o número vem com a procedência", () => {
  it("variável de ambiente é declarada como tal", async () => {
    const { limitesDaCaixa } = await import("../src/container");
    const antes = process.env.SAST_JOBS;
    process.env.SAST_JOBS = "1";
    try {
      const b = limitesDaCaixa();
      expect(b.sastJobs).toBe(1);
      // A distinção que importa: aqui não há caixa pequena nenhuma — alguém
      // escreveu `1` no painel, e é isso que precisa ser desfeito.
      expect(b.sastJobsDe).toBe("env");
    } finally {
      if (antes === undefined) delete process.env.SAST_JOBS;
      else process.env.SAST_JOBS = antes;
    }
  });

  it("sem env e sem cgroup, o número é do hospedeiro", async () => {
    const { limitesDaCaixa } = await import("../src/container");
    const antesJ = process.env.SAST_JOBS;
    const antesS = process.env.SCAN_SLOTS;
    delete process.env.SAST_JOBS;
    delete process.env.SCAN_SLOTS;
    try {
      const b = limitesDaCaixa();
      // Esta suíte roda fora de contêiner: não há cota declarada.
      expect(b.cotaDeCpu).toBeNull();
      expect(b.sastJobsDe).toBe("hospedeiro");
      expect(b.scanSlotsDe).toBe("hospedeiro");
      expect(b.hospedeiro).toBeGreaterThanOrEqual(1);
    } finally {
      if (antesJ !== undefined) process.env.SAST_JOBS = antesJ;
      if (antesS !== undefined) process.env.SCAN_SLOTS = antesS;
    }
  });
});
