// ============================================================
// Os scanners estão instalados no host? Ver AUDITORIA.md#ARQ-07.
//
// Binário ausente não derruba mais a fase (isso foi o UX-15), mas segue
// produzindo um scan que não escaneia nada. Quem opera precisa descobrir isso
// pelo /api/health, e não por um relatório vazio que parece um repositório
// limpo. NODE-ONLY.
// ============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN, ENGINES } from "./config";
import { podeCairParaLocal } from "./scan-transport";
import { ScanUnavailable } from "./git";
import { translate } from "./i18n/translate";
import type { Locale } from "./i18n/config";

const pExecFile = promisify(execFile);

export interface BinaryStatus {
  name: string;
  configured: string;
  /** `false` = engine desligado por configuração; não é problema. */
  required: boolean;
  present: boolean;
  version?: string;
}

/**
 * `--version` é a checagem honesta: existir no PATH não garante que executa
 * (arquitetura errada, dependência faltando). Timeout curto porque isto
 * responde uma requisição HTTP — e, no VS Code, roda a cada abertura de
 * projeto.
 *
 * O resultado é memorizado por `PROBE_TTL_MS`: o `probe` de cada analisador é
 * chamado toda vez que alguém monta um plano, e no editor isso acontece a cada
 * clique na árvore. Sem cache, seriam dois processos por clique.
 */
const PROBE_TTL_MS = 60_000;
const probeCache = new Map<string, { at: number; value: BinaryProbe }>();

export interface BinaryProbe {
  present: boolean;
  version?: string;
}

export async function probeBinary(bin: string): Promise<BinaryProbe> {
  const hit = probeCache.get(bin);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value;

  let value: BinaryProbe;
  try {
    const { stdout } = await pExecFile(bin, ["--version"], {
      timeout: 5_000,
      maxBuffer: 1024 * 64,
    });
    value = { present: true, version: stdout.trim().split("\n")[0]?.slice(0, 80) };
  } catch {
    value = { present: false };
  }
  probeCache.set(bin, { at: Date.now(), value });
  return value;
}

/** Esquece o que foi medido — o `doctor` precisa ver o estado de AGORA. */
export function clearProbeCache(): void {
  probeCache.clear();
  cache = null;
}

/**
 * Tenta no servidor; se a REDE falhar e o binário existir aqui, faz aqui.
 *
 * Nasceu de um relato de uma frase: "deu fetch failed, continua não fazendo a
 * análise". O servidor do MVP hiberna quando fica ocioso, e a primeira
 * requisição depois disso pode não voltar. Até aqui, isso derrubava o
 * analisador inteiro — com o `opengrep` instalado na máquina, parado, sem ser
 * chamado. **Não analisar nada é o pior desfecho possível para uma ferramenta
 * de segurança**, e é pior que analisar mais devagar.
 *
 * Três limites, todos deliberados:
 *
 * - **Só falha de rede.** `podeCairParaLocal` recusa `unauthorized` (é sessão,
 *   precisa ser resolvida) e `too_large` (continuaria grande aqui). Contornar
 *   esses dois esconderia o que a pessoa precisa consertar.
 * - **Só com o binário presente.** Sem ele não há nada a fazer localmente, e o
 *   erro do servidor é a informação certa a mostrar.
 * - **Sempre declarado.** A troca aparece na tela via `report`. Mudar em
 *   silêncio o lugar onde o código é processado é o tipo de decisão que este
 *   produto não toma pelas costas de ninguém — mesmo que a mudança seja para
 *   o lado mais privado, que é o caso: o local não manda nada para fora.
 */
export async function comSocorroLocal<T>(
  remoto: () => Promise<T>,
  local: () => Promise<T>,
  bin: string | null,
  ctx: { locale: Locale; report?: (message: string, pct?: number) => void }
): Promise<T> {
  try {
    return await remoto();
  } catch (e) {
    if (!podeCairParaLocal(e)) throw e;

    // Falhou lá E não dá para fazer aqui: a pessoa precisa das DUAS metades.
    //
    // Com só a primeira — "não foi possível falar com o servidor: timeout" —
    // o próximo passo fica escondido. Quem lê isso não tem como saber que
    // existe um caminho local, nem que ele está a uma configuração de
    // distância. A frase junta o que houve com o que resolve.
    const r = bin ? await probeBinary(bin) : { present: false };
    if (!r.present) {
      throw new ScanUnavailable(
        `${(e as Error).message}\n${translate(ctx.locale, "scan.noLocalFallback", {
          bin: bin ?? "—",
        })}`
      );
    }

    const motivo = (e as Error).message;
    ctx.report?.(translate(ctx.locale, "scan.fellBackLocal", { bin: bin! }));
    // O motivo vai junto no canal de saída de quem estiver escutando: a frase
    // curta explica O QUE mudou, e esta explica POR QUÊ.
    ctx.report?.(motivo);
    return await local();
  }
}

const TTL_MS = 60_000;
let cache: { at: number; value: BinaryStatus[] } | null = null;

/** Rota pública: sem cache, cada chamada dispararia dois processos. */
export async function checkBinaries(): Promise<BinaryStatus[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const alvos = [
    { name: "sast", configured: BIN[ENGINES.sast as keyof typeof BIN] ?? ENGINES.sast, required: ENGINES.sast !== "none" },
    { name: "sca", configured: BIN[ENGINES.sca as keyof typeof BIN] ?? ENGINES.sca, required: ENGINES.sca !== "none" },
  ];

  const value = await Promise.all(
    alvos.map(async (a) => {
      if (!a.required) return { ...a, present: false };
      const r = await probeBinary(a.configured);
      return { ...a, ...r };
    })
  );

  cache = { at: Date.now(), value };
  return value;
}
