// ============================================================
// O laço do worker contra um banco que não responde.
//
// Do deploy de 07/08/2026, servidor dedicado. O log inteiro do contêiner, dos
// primeiros três minutos, era esta entrada repetida — vinte linhas de SQL,
// idênticas, a cada 15 segundos (5 s de pausa + 10 s de `connectionTimeoutMillis`):
//
//   worker.loop.failed … UPDATE starguard.jobs SET … ← Connection terminated
//   due to connection timeout ← Connection terminated unexpectedly
//
// Duas coisas erradas de uma vez: a cadência (a mesma de fila vazia, contra um
// banco fora do ar) e o volume (240 entradas por hora, escondendo qualquer
// outra coisa que o servidor tivesse a dizer — inclusive o aviso do boot que
// explica o problema).
//
// Ver AUDITORIA.md#BUG-30.
// ============================================================
import { describe, it, expect } from "vitest";
import { pausaAposFalha, deveRegistrarFalha } from "@/lib/worker";

/** O padrão de `QUEUE_POLL_MS`, lido na avaliação do módulo. */
const OCIOSO = 5_000;
/** O padrão de `QUEUE_BACKOFF_MAX_MS`. */
const TETO = 60_000;

describe("pausaAposFalha", () => {
  it("a primeira falha não penaliza: espera o mesmo que a fila vazia", () => {
    // Oscilação de rede é comum e passa sozinha. Punir a 1ª falha com meio
    // minuto atrasaria trabalho real por um soluço.
    expect(pausaAposFalha(1)).toBe(OCIOSO);
  });

  it("dobra a cada falha seguida", () => {
    expect(pausaAposFalha(2)).toBe(10_000);
    expect(pausaAposFalha(3)).toBe(20_000);
    expect(pausaAposFalha(4)).toBe(40_000);
  });

  it("para de dobrar no teto — um banco que volta é reencontrado em 1 min", () => {
    // Sem teto, 20 falhas seguidas dariam uma espera de semanas: o banco
    // voltaria e ninguém iria buscar. A fila usa `run_after`, então nada se
    // perde — mas ninguém quer esperar até quinta-feira.
    expect(pausaAposFalha(5)).toBe(TETO);
    expect(pausaAposFalha(50)).toBe(TETO);
    expect(pausaAposFalha(5_000)).toBe(TETO);
  });

  it("nunca devolve 0 nem negativo — seria um laço quente contra o banco", () => {
    // `falhas = 0` não acontece no laço (só se chama isto depois de falhar),
    // mas uma pausa de 0 aqui viraria uma tempestade de conexões, que é o pior
    // que se pode fazer com um Postgres já em dificuldade.
    expect(pausaAposFalha(0)).toBeGreaterThan(0);
    expect(pausaAposFalha(-1)).toBeGreaterThan(0);
  });
});

describe("deveRegistrarFalha", () => {
  it("registra a PRIMEIRA — é a que traz o erro no momento em que começou", () => {
    expect(deveRegistrarFalha(1)).toBe(true);
  });

  it("depois, só nas potências de dois", () => {
    for (const n of [2, 4, 8, 16, 32, 64, 1024]) {
      expect(deveRegistrarFalha(n), `falha ${n}`).toBe(true);
    }
    for (const n of [3, 5, 6, 7, 9, 15, 31, 100]) {
      expect(deveRegistrarFalha(n), `falha ${n}`).toBe(false);
    }
  });

  it("cala menos de 15 linhas na primeira hora, onde havia 240", () => {
    // A conta que justifica o desenho. Com o backoff acima, uma hora de banco
    // fora do ar rende poucas dezenas de tentativas; destas, só as potências de
    // dois viram log.
    let decorrido = 0;
    let falhas = 0;
    let registradas = 0;
    while (decorrido < 3_600_000) {
      falhas++;
      if (deveRegistrarFalha(falhas)) registradas++;
      decorrido += pausaAposFalha(falhas);
    }

    expect(falhas).toBeLessThan(70); // era ~240
    expect(registradas).toBeLessThan(15);
    // Mas NUNCA zero: um log silencioso sobre um banco fora do ar é pior que um
    // ruidoso. A prova de que ainda está fora tem de continuar aparecendo.
    expect(registradas).toBeGreaterThan(3);
  });
});
