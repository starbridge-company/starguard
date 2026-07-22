// ============================================================
// Parse dos filtros de listagem de análises (query string -> filtros do repo).
// Datas em YYYY-MM-DD; "to" é convertido para exclusivo (fim do dia, UTC).
// ============================================================
import type { AnalysisFilters, AnalysisStatus } from "@/lib/repos/analyses";

const STATUSES: AnalysisStatus[] = ["pending", "running", "done", "error"];

function parseDate(v: string | null, endExclusive = false): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return undefined;
  if (endExclusive) d.setUTCDate(d.getUTCDate() + 1); // inclui o dia inteiro do "to"
  return d;
}

export function parseAnalysisFilters(sp: URLSearchParams): AnalysisFilters {
  const status = sp.get("status");
  return {
    q: sp.get("q") || undefined,
    status:
      status && (STATUSES as string[]).includes(status)
        ? (status as AnalysisStatus)
        : undefined,
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to"), true),
  };
}
