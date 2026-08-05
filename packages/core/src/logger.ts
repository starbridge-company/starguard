// ============================================================
// Log estruturado. Ver AUDITORIA.md#ARQ-07.
//
// O projeto só tinha `console.log` com texto solto: não dava para responder
// "quanto tempo a Fase 3 leva?", "qual a taxa de erro por fase?" nem "qual
// scanner está lento?" sem ler linha por linha. Uma linha por evento, em JSON,
// resolve isso com o que já existe (stdout) — sem trazer dependência nova para
// um MVP.
//
// Em desenvolvimento o JSON atrapalha mais do que ajuda, então ali sai em
// texto legível. NODE-ONLY.
// ============================================================
import { redact } from "./redact";

export type Level = "debug" | "info" | "warn" | "error";

/** Campos que se repetem entre eventos e ajudam a correlacionar. */
export interface LogContext {
  jobId?: string;
  userId?: string;
  phase?: string;
  engine?: string;
  durationMs?: number;
  [k: string]: unknown;
}

const PRETTY = process.env.LOG_FORMAT
  ? process.env.LOG_FORMAT !== "json"
  : process.env.NODE_ENV !== "production";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = ORDER[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;

/**
 * Valores viram texto redigido antes de sair.
 *
 * O log recebe mensagem de erro de ferramenta externa (git, scanners,
 * provedores de IA) — o mesmo texto que já obrigou a redação em `redact.ts`
 * quando ia para o banco. Um PAT no stdout é vazamento igual.
 */
function safe(v: unknown): unknown {
  if (typeof v === "string") return redact(v);
  if (v instanceof Error) return redact(v.message);
  return v;
}

function emit(level: Level, event: string, ctx: LogContext = {}): void {
  if (ORDER[level] < MIN) return;

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined) clean[k] = safe(v);
  }

  if (PRETTY) {
    const extra = Object.entries(clean)
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" ");
    const line = `[${level}] ${event}${extra ? ` ${extra}` : ""}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
    return;
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...clean,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  debug: (event: string, ctx?: LogContext) => emit("debug", event, ctx),
  info: (event: string, ctx?: LogContext) => emit("info", event, ctx),
  warn: (event: string, ctx?: LogContext) => emit("warn", event, ctx),
  error: (event: string, ctx?: LogContext) => emit("error", event, ctx),
};

/**
 * Mede um trecho e registra a duração — que é a métrica que faltava.
 * Sucesso e falha saem com o mesmo `event`, mudando só o nível e o `ok`,
 * para dar taxa de erro por fase sem parsear texto.
 */
export async function timed<T>(
  event: string,
  ctx: LogContext,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const out = await fn();
    log.info(event, { ...ctx, ok: true, durationMs: Date.now() - started });
    return out;
  } catch (e) {
    log.error(event, {
      ...ctx,
      ok: false,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
