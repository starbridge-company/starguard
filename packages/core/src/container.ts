// ============================================================
// Quanto desta máquina é REALMENTE nosso — AUDITORIA.md#ARQ-15.
//
// `os.cpus().length` dentro de um contêiner devolve os núcleos do HOSPEDEIRO,
// não a fatia que o contêiner recebeu. Num servidor de 0,5 CPU e 512 MB, essa
// função responde 8 ou 16 — e quem usa esse número para dimensionar trabalho
// paralelo abre oito processos numa caixa que comporta um.
//
// Foi exatamente isso que derrubou o scan remoto: o SAST rodava com
// `--jobs <núcleos do hospedeiro>`, a instância estourava a memória e morria no
// meio da requisição. O sintoma chegava ao editor como "403" e "502" — páginas
// de erro da borda, sem corpo JSON nenhum —, porque não havia mais servidor do
// outro lado para responder. Um analisador que MATA o próprio servidor não
// falha: ele derruba os vizinhos junto, e foi o que aconteceu com o `sca` que
// rodava em paralelo.
//
// Os limites vêm do cgroup, que é onde o contêiner os declara. As funções de
// leitura de arquivo ficam separadas das de INTERPRETAÇÃO de propósito: as
// segundas são puras e têm teste, e são elas que concentram a aritmética onde
// o erro moraria.
// ============================================================
import { readFileSync } from "node:fs";
import { cpus } from "node:os";

/**
 * Interpreta o `cpu.max` do cgroup v2: "<cota> <período>", ou "max <período>"
 * quando não há limite. Devolve a fatia em CPUs, ou `null` sem limite.
 */
export function cpusDeCgroupV2(conteudo: string | null): number | null {
  if (!conteudo) return null;
  const [cota, periodo] = conteudo.trim().split(/\s+/);
  if (!cota || cota === "max") return null;
  const c = Number(cota);
  const p = Number(periodo || 100_000);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0 || c <= 0) return null;
  return c / p;
}

/** O mesmo, no cgroup v1: cota e período em arquivos separados. */
export function cpusDeCgroupV1(cota: string | null, periodo: string | null): number | null {
  const c = Number((cota ?? "").trim());
  const p = Number((periodo ?? "").trim());
  // -1 é o valor que o cgroup v1 usa para "sem limite".
  if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(p) || p <= 0) return null;
  return c / p;
}

/**
 * Quantos processos paralelos cabem, dada a fatia de CPU.
 *
 * Arredonda para BAIXO e nunca devolve menos de 1: meia CPU não comporta dois
 * processos que competem por ela, e zero processo não faz trabalho nenhum.
 */
export function processosPara(fatiaDeCpu: number | null, hospedeiro: number): number {
  if (fatiaDeCpu === null) return Math.max(1, hospedeiro);
  return Math.max(1, Math.floor(fatiaDeCpu));
}

function lerOuNulo(caminho: string): string | null {
  try {
    return readFileSync(caminho, "utf8");
  } catch {
    return null;
  }
}

/**
 * Paralelismo disponível de verdade.
 *
 * Fora de contêiner (sem cgroup, ou sem limite declarado) é o número de
 * núcleos, que é o comportamento de sempre — o desenvolvimento na máquina de
 * alguém não fica mais lento por causa disto.
 */
export function paralelismoDisponivel(): number {
  const hospedeiro = Math.max(1, cpus().length);
  const v2 = cpusDeCgroupV2(lerOuNulo("/sys/fs/cgroup/cpu.max"));
  if (v2 !== null) return processosPara(v2, hospedeiro);
  const v1 = cpusDeCgroupV1(
    lerOuNulo("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
    lerOuNulo("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
  );
  return processosPara(v1, hospedeiro);
}

/** Memória do contêiner em MB, ou `null` quando não há limite declarado. */
export function memoriaDeCgroup(conteudo: string | null): number | null {
  if (!conteudo) return null;
  const v = conteudo.trim();
  // "max" no v2; no v1 o "sem limite" é um número absurdo (9223372036854771712).
  if (v === "max") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1024 ** 4) return null;
  return Math.floor(n / (1024 * 1024));
}

export function memoriaDisponivelMb(): number | null {
  return (
    memoriaDeCgroup(lerOuNulo("/sys/fs/cgroup/memory.max")) ??
    memoriaDeCgroup(lerOuNulo("/sys/fs/cgroup/memory/memory.limit_in_bytes"))
  );
}
