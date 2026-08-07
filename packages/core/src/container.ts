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

// ------------------------------------------------------------
// O que o SAST deriva desses limites
// ------------------------------------------------------------
//
// Estas duas moravam em `config.ts`, e isso derrubou o painel INTEIRO.
//
// `config.ts` é reexportado por `lib/config.ts`, que é importado pelo
// `middleware.ts` — e o middleware roda no **Edge runtime**, onde `node:fs` e
// `node:os` não existem. O empacotador puxa o grafo inteiro: bastava
// `config.ts` importar este arquivo para o middleware deixar de compilar, e um
// middleware que não compila responde **404 em todas as rotas**. Não uma rota:
// o site.
//
// O que torna esse erro perigoso é que ele não aparece em lugar nenhum antes de
// acontecer — `tsc`, ESLint e `npm test` passam os três, porque nenhum deles
// sabe o que é o Edge runtime. Só o `next dev`/`next build` reclama, e a
// mensagem fala de `node:fs`, não do middleware.
//
// Aqui é o lugar certo por dois motivos, e o segundo é o que importa: elas SÃO
// derivações do limite do contêiner, e este arquivo já é NODE-ONLY por natureza
// — ninguém o importa de um caminho de borda por engano.
//
// Travado por teste em `packages/core/tests/boundary.test.ts`.

/**
 * Quantos processos o SAST pode abrir — AUDITORIA.md#ARQ-15.
 *
 * Sai do CGROUP, não de `os.cpus()`. A diferença derrubou o servidor: dentro do
 * contêiner, `os.cpus()` conta os núcleos do hospedeiro, e o scan abria oito
 * processos numa instância de meia CPU e 512 MB. A memória estourava, a
 * instância morria no meio da requisição e o editor recebia a página de erro da
 * borda — sem corpo JSON, o que fazia a mensagem virar "403" sem autor.
 *
 * `SAST_JOBS` tem precedência: quem hospeda sabe da própria caixa.
 */
export function sastJobs(): number {
  const env = Number(process.env.SAST_JOBS);
  if (Number.isFinite(env) && env >= 1) return Math.floor(env);
  return processosDeScan(paralelismoDisponivel());
}

/**
 * Quantos processos de scanner abrir, deixando o Node RESPIRAR.
 *
 * O scanner não é o único morador desta caixa: o mesmo processo Node responde
 * `/api/status`, `/api/scan?job=…` e o health check enquanto o opengrep roda. Com
 * `--jobs` igual a todos os núcleos, o scan tomava a máquina inteira e o servidor
 * parava de responder no meio da própria análise — que é como um scan lento vira
 * um scan que "travou" para quem está olhando.
 *
 * Guardar um núcleo é barato: numa caixa de 16, é 1/16 do paralelismo do
 * scanner em troca de o servidor continuar atendendo. Numa caixa pequena
 * (1 ou 2 núcleos, que é o caso da produção) nada muda — não há o que reservar,
 * e o piso de 1 continua valendo.
 */
export function processosDeScan(nucleos: number): number {
  if (nucleos <= 2) return Math.max(1, nucleos);
  return nucleos - 1;
}

/**
 * Quanto RESULTADO de scanner esta caixa aguenta segurar, em MB.
 *
 * O número existe porque o resultado é a única coisa neste caminho que não tem
 * tamanho previsível: os arquivos de entrada são limitados por `SCAN_MAX_BYTES`,
 * mas um repositório com um arquivo gerado pode render dezenas de MB de JSON.
 *
 * E ele não custa o que aparenta. Um JSON de N bytes vira, no V8, a string em
 * UTF-16 (2N) mais o grafo de objetos do `JSON.parse` — na prática **3 a 4×** o
 * tamanho do arquivo, tudo vivo ao mesmo tempo. Por isso a fatia é pequena em
 * relação à caixa: 5%, com piso de 8 MB para não inviabilizar um repositório
 * normal e teto de 64 MB porque acima disso o problema é outro (é um arquivo
 * gerado sendo escaneado, e a resposta certa é excluí-lo, não comprar RAM).
 *
 * Fora de contêiner, sem limite declarado, vale o teto — a máquina de quem
 * desenvolve não precisa desta defesa.
 */
export function tetoDeSaidaMb(): number {
  const env = Number(process.env.SCAN_MAX_OUTPUT_MB);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  const total = memoriaDisponivelMb();
  if (!total) return 64;
  return Math.min(64, Math.max(8, Math.floor(total * 0.05)));
}

/**
 * O tamanho da caixa, com a PROCEDÊNCIA de cada número.
 *
 * Existe porque `/api/health` publicava `slots: 1` e mais nada, e esse `1` tem
 * três origens que pedem consertos completamente diferentes:
 *
 *   - o contêiner tem cota de CPU no cgroup (mexer no plano/no Coolify);
 *   - `SCAN_SLOTS`/`SAST_JOBS` estão fixados em 1 no ambiente (herança da
 *     instância de meia CPU: quem hospeda seguiu o DEPLOY.md e a caixa mudou);
 *   - a máquina tem um núcleo mesmo.
 *
 * Sem essa distinção, "por que o scan demora tanto no servidor dedicado?" não
 * tem resposta possível de fora — e foi exatamente essa a pergunta. É a mesma
 * regra do `UnavailableReason`: o número aparece com o motivo, nunca sozinho.
 */
export function limitesDaCaixa(): {
  /** Núcleos que o SO enxerga. Dentro do contêiner, são os do HOSPEDEIRO. */
  hospedeiro: number;
  /** Fatia declarada no cgroup, em CPUs. `null` = sem cota declarada. */
  cotaDeCpu: number | null;
  /** Memória do contêiner em MB. `null` = sem limite declarado. */
  memoriaMb: number | null;
  /** Processos que o SAST abre, e de onde o número veio. */
  sastJobs: number;
  sastJobsDe: "env" | "cgroup" | "hospedeiro";
  scanSlotsDe: "env" | "cgroup" | "hospedeiro";
} {
  const hospedeiro = Math.max(1, cpus().length);
  const cotaDeCpu =
    cpusDeCgroupV2(lerOuNulo("/sys/fs/cgroup/cpu.max")) ??
    cpusDeCgroupV1(
      lerOuNulo("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
      lerOuNulo("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    );
  const envJobs = Number(process.env.SAST_JOBS);
  const envSlots = Number(process.env.SCAN_SLOTS);
  const daCota = cotaDeCpu === null ? "hospedeiro" : "cgroup";
  return {
    hospedeiro,
    cotaDeCpu,
    memoriaMb: memoriaDisponivelMb(),
    sastJobs: sastJobs(),
    sastJobsDe: Number.isFinite(envJobs) && envJobs >= 1 ? "env" : daCota,
    scanSlotsDe: Number.isFinite(envSlots) && envSlots >= 1 ? "env" : daCota,
  };
}

/**
 * Teto de memória por processo do SAST, em MB, ou `null` para não passar a
 * flag. Derivado do limite do contêiner, dividido pelos processos e com folga
 * para o Node — que também mora nesta caixa.
 */
export function sastMaxMemoryMb(): number | null {
  const env = Number(process.env.SAST_MAX_MEMORY_MB);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  const total = memoriaDisponivelMb();
  if (!total) return null;
  // Metade da caixa para os scanners, dividida entre os processos. A outra
  // metade é do Node, do JSON de saída e do sistema.
  return Math.max(128, Math.floor((total * 0.5) / sastJobs()));
}
