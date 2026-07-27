"use client";

// ============================================================
// Polling da análise em andamento.
//
// A versão anterior tinha dois defeitos que se agravavam mutuamente:
//  - intervalo fixo de 1,4 s, sem pausa e sem teto → ~43 req/min POR ABA,
//    o que sozinho consumia metade da cota global de 100/min (BUG-03);
//  - o `catch` não reagendava nada → um único 429 ou oscilação de rede
//    congelava a tela num erro permanente, com o job rodando normalmente
//    no servidor (BUG-04).
//
// Agora: intervalo cresce com o tempo de vida do job, pausa quando a aba sai
// de vista, e falha transitória volta sozinha (só vira erro visível depois de
// algumas seguidas).
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { apiGet, isAbortError } from "@/lib/client";
import { useApiError } from "@/lib/i18n";
import type { Job } from "@/types";

const TERMINAL = new Set(["done", "error"]);

export function allTerminal(job: Job): boolean {
  return (Object.values(job.phases) as { status: string }[]).every((p) =>
    TERMINAL.has(p.status)
  );
}

/** Rápido no começo (o usuário acabou de disparar), espaçado depois. */
function nextDelay(elapsedMs: number): number {
  if (elapsedMs < 15_000) return 1_500;
  if (elapsedMs < 60_000) return 3_000;
  return 6_000;
}

/** Falhas seguidas antes de mostrar erro ao usuário. */
const FAILURES_BEFORE_ERROR = 4;

export interface AnalysisPolling {
  job: Job | null;
  error: string | null;
  /** Falhando, mas ainda tentando sozinho — a UI pode avisar discretamente. */
  degraded: boolean;
  retry: () => void;
}

export function useAnalysisPolling(id: string): AnalysisPolling {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const apiError = useApiError();

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const schedule = (ms: number) => {
      if (cancelled || finished) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), ms);
    };

    const run = async () => {
      if (cancelled || finished) return;

      // Aba em segundo plano não gasta requisição; o visibilitychange retoma.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule(5_000);
        return;
      }

      try {
        const data = await apiGet<Job>(`/api/status/${id}`);
        if (cancelled) return;
        failures = 0;
        setDegraded(false);
        setError(null);
        setJob(data);
        if (allTerminal(data)) {
          finished = true;
          return;
        }
        schedule(nextDelay(Date.now() - startedAt));
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        failures += 1;
        setDegraded(true);
        if (failures >= FAILURES_BEFORE_ERROR) {
          setError(
            apiError(e, "results.loadFailed")
          );
        }
        // 2s, 4s, 8s, 16s… teto de 30s.
        schedule(Math.min(30_000, 2_000 * 2 ** (failures - 1)));
      }
    };

    void run();

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [id, nonce, apiError]);

  return { job, error, degraded, retry };
}
