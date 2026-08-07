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
/**
 * Quantos elos da corrente de `cause` são seguidos.
 *
 * Três bastam para o caso real (Drizzle → pg → erro do socket) e impedem que
 * um ciclo de `cause` — que existe — transforme o log num laço infinito.
 */
const CAUSAS_MAX = 3;

function safe(v: unknown): unknown {
  if (typeof v === "string") return redact(v);
  if (v instanceof Error) return redact(mensagemComCausa(v));
  return v;
}

/**
 * A mensagem do erro **mais a corrente de `cause`**.
 *
 * Pegar só `error.message` foi um buraco caro de diagnóstico. O Drizzle embrulha
 * toda falha de consulta num erro cuja mensagem é o SQL:
 *
 *   Failed query:
 *     UPDATE starguard.jobs SET status = 'running' … RETURNING id, kind, …
 *   params: 7-a35963f3
 *
 * …e guarda o motivo REAL em `cause` — `relation "starguard.jobs" does not
 * exist`, `password authentication failed`, `connection refused`. Sem ele, o
 * log repetia a consulta a cada 15 segundos sem dizer nada sobre a causa, e
 * quem estava depurando tinha um paredão de SQL e zero informação. Três
 * problemas diferentes (schema atrasado, credencial errada, banco fora do ar)
 * saíam com a MESMA linha.
 *
 * Cada elo passa por `redact`: um erro de conexão do `pg` costuma trazer a URL
 * do banco, com senha. Ver `redact.ts`.
 */
function mensagemComCausa(e: Error): string {
  const partes: string[] = [e.message];
  let atual: unknown = e.cause;
  const vistos = new Set<unknown>([e]);

  for (let i = 0; i < CAUSAS_MAX && atual; i++) {
    if (vistos.has(atual)) break;
    vistos.add(atual);
    if (atual instanceof Error) {
      // `code` é o que identifica o erro do Postgres (`42P01` = tabela não
      // existe) e do socket (`ECONNREFUSED`). Vale mais que a frase.
      const codigo = (atual as { code?: unknown }).code;
      partes.push(`${codigo ? `[${String(codigo)}] ` : ""}${atual.message}`);
      atual = atual.cause;
    } else {
      partes.push(String(atual));
      break;
    }
  }
  return partes.join(" ← ");
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
