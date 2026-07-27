// ============================================================
// Os scanners estão instalados no host? Ver AUDITORIA.md#ARQ-07.
//
// Binário ausente não derruba mais a fase (isso foi o UX-15), mas segue
// produzindo um scan que não escaneia nada. Quem opera precisa descobrir isso
// pelo /api/health, e não por um relatório vazio que parece um repositório
// limpo. NODE-ONLY.
// ============================================================
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BIN, ENGINES } from "@/lib/config";

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
 * responde uma requisição HTTP.
 */
async function probe(bin: string): Promise<{ present: boolean; version?: string }> {
  try {
    const { stdout } = await pExecFile(bin, ["--version"], {
      timeout: 5_000,
      maxBuffer: 1024 * 64,
    });
    return { present: true, version: stdout.trim().split("\n")[0]?.slice(0, 80) };
  } catch {
    return { present: false };
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
      const r = await probe(a.configured);
      return { ...a, ...r };
    })
  );

  cache = { at: Date.now(), value };
  return value;
}
