// ============================================================
// Prontidão do servidor antes do fluxo OAuth.
//
// Abrir o navegador quando o próprio servidor informa que não alcança o banco
// deixa a extensão esperando um código que nunca poderá ser emitido. A pessoa
// vê um spinner por minutos e conclui que o SAST travou, embora o scanner nem
// tenha começado. Esta sonda transforma esse caminho num erro curto e correto.
// ============================================================

export type ReadinessErrorKey =
  | "err.databaseUnavailable"
  | "err.schemaOutdated"
  | "err.network";

export interface ServerReadiness {
  ok: boolean;
  errorKey?: ReadinessErrorKey;
  /** Detalhe técnico vai para o canal de saída, não substitui a tradução. */
  detail?: string;
}

interface HealthBody {
  db?: string;
  message?: string;
  schema?: { ok?: boolean; pending?: string[] };
}

export function classifyHealth(resOk: boolean, body: HealthBody): ServerReadiness {
  if (body.db === "unreachable") {
    return {
      ok: false,
      errorKey: "err.databaseUnavailable",
      detail: body.message,
    };
  }
  if (body.schema?.ok === false && (body.schema.pending?.length ?? 0) > 0) {
    return {
      ok: false,
      errorKey: "err.schemaOutdated",
      detail: body.message,
    };
  }
  if (!resOk) {
    return { ok: false, errorKey: "err.network", detail: body.message };
  }
  return { ok: true };
}

export async function checkServerReadiness(
  baseUrl: string,
  opts: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<ServerReadiness> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/health`, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => ({}))) as HealthBody;
    return classifyHealth(res.ok, body);
  } catch (e) {
    return {
      ok: false,
      errorKey: "err.network",
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}
