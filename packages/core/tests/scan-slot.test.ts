// ============================================================
// A vaga do scanner — AUDITORIA.md#ARQ-15, #ARQ-16.
//
// A defesa contra dois scanners nativos na mesma caixa existia, mas estava na
// borda errada: dentro de `app/api/scan/route.ts`. Isso a fazia valer só para a
// extensão. A análise pedida pelo PAINEL WEB chama `runSast`/`runSca` dentro do
// próprio processo, por `lib/jobs.ts`, sem passar por rota nenhuma — bastava
// alguém clicar "analisar" no navegador enquanto um editor escaneava para o
// opengrep e o trivy se encontrarem nos mesmos 512 MB.
//
// A vaga passou para o núcleo, colada em quem gasta o recurso. Toda entrada
// atravessa o mesmo portão porque todas chamam as mesmas funções.
// ============================================================
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { comVaga, naFilaDeVagas, resetScanSlots, scanSlots, vagasEmUso } from "../src/scan-slot";

beforeEach(() => {
  process.env.SCAN_SLOTS = "1";
  resetScanSlots();
});
afterEach(() => {
  delete process.env.SCAN_SLOTS;
  resetScanSlots();
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("com uma vaga só, ninguém escaneia junto", () => {
  it("dois scanners nunca rodam ao mesmo tempo", async () => {
    let emVoo = 0;
    let pico = 0;
    const trabalho = async () => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await espera(10);
      emVoo--;
    };

    await Promise.all([comVaga(trabalho), comVaga(trabalho), comVaga(trabalho)]);
    expect(pico).toBe(1);
  });

  it("mas todos rodam — esperar a vez não é ser recusado", async () => {
    const feitos: number[] = [];
    await Promise.all([1, 2, 3].map((n) => comVaga(async () => void feitos.push(n))));
    expect(feitos.sort()).toEqual([1, 2, 3]);
  });

  it("a fila é FIFO: quem chegou primeiro passa primeiro", async () => {
    // Com `pop` no lugar de `shift`, quem chegasse primeiro esperaria enquanto
    // os recém-chegados passassem na frente — indefinidamente, sob carga.
    const ordem: number[] = [];
    const primeiro = comVaga(async () => {
      ordem.push(0);
      await espera(20);
    });
    await espera(1);
    const resto = [1, 2, 3].map((n) =>
      comVaga(async () => {
        ordem.push(n);
      })
    );
    await Promise.all([primeiro, ...resto]);
    expect(ordem).toEqual([0, 1, 2, 3]);
  });
});

describe("a vaga volta SEMPRE", () => {
  it("um scanner que falha não trava a fila", async () => {
    // O caso real: opengrep ausente no host. Sem o `finally`, o primeiro erro
    // deixaria a instância sem escanear nada até reiniciar.
    await expect(
      comVaga(async () => {
        throw new Error("opengrep não encontrado");
      })
    ).rejects.toThrow("opengrep");

    expect(vagasEmUso()).toBe(0);
    await expect(comVaga(async () => "depois")).resolves.toBe("depois");
  });

  it("terminado o trabalho, não sobra vaga ocupada nem ninguém esperando", async () => {
    await Promise.all([comVaga(() => espera(5)), comVaga(() => espera(5))]);
    expect(vagasEmUso()).toBe(0);
    expect(naFilaDeVagas()).toBe(0);
  });
});

describe("quem espera é avisado, e com a posição", () => {
  it("o primeiro não recebe aviso — ele não esperou ninguém", async () => {
    const avisos: number[] = [];
    await comVaga(async () => "ok", (p) => avisos.push(p));
    expect(avisos).toEqual([]);
  });

  it("quem entra na fila recebe a própria posição", async () => {
    const avisos: number[] = [];
    const segurando = comVaga(() => espera(30));
    await espera(1);
    const segundo = comVaga(async () => "b", (p) => avisos.push(p));
    await espera(1);
    const terceiro = comVaga(async () => "c", (p) => avisos.push(p));
    await Promise.all([segurando, segundo, terceiro]);
    expect(avisos).toEqual([1, 2]);
  });
});

describe("quantas vagas", () => {
  it("`SCAN_SLOTS` manda — quem hospeda sabe da própria caixa", () => {
    process.env.SCAN_SLOTS = "3";
    expect(scanSlots()).toBe(3);
  });

  it("sem configuração, sai do que a máquina realmente tem", () => {
    // No contêiner de meia CPU responde 1 e os scanners passam um de cada vez;
    // na máquina de quem desenvolve responde os núcleos e nada é serializado.
    // Um teto fixo em 1 tornaria o terminal de todo mundo mais lento para
    // proteger uma caixa que não é a deles.
    delete process.env.SCAN_SLOTS;
    expect(scanSlots()).toBeGreaterThanOrEqual(1);
  });

  it("valor inválido não desliga a proteção", () => {
    process.env.SCAN_SLOTS = "zero";
    expect(scanSlots()).toBeGreaterThanOrEqual(1);
  });

  it("com duas vagas, dois rodam juntos e o terceiro espera", async () => {
    process.env.SCAN_SLOTS = "2";
    resetScanSlots();
    let emVoo = 0;
    let pico = 0;
    const trabalho = async () => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await espera(10);
      emVoo--;
    };
    await Promise.all([comVaga(trabalho), comVaga(trabalho), comVaga(trabalho)]);
    expect(pico).toBe(2);
  });
});
