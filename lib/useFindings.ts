"use client";

// Estado por achado (aberto / corrigido / falso positivo…), indexado pelo id
// posicional que a tela já usa ("V-3"). Ver AUDITORIA.md#FEAT-01.
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch } from "@/lib/client";
import type { MessageKey } from "@/lib/i18n";

export type FindingStatus =
  | "open"
  | "fixed"
  | "pr_open"
  | "pr_merged"
  | "false_positive"
  | "accepted_risk";

/** Estados que tiram o achado da lista de trabalho. */
export const RESOLVED_STATUS: FindingStatus[] = [
  "fixed",
  "pr_merged",
  "false_positive",
  "accepted_risk",
];

/** Chave de tradução de cada estado (AUDITORIA.md#FEAT-04). */
export const STATUS_KEY: Record<FindingStatus, MessageKey> = {
  open: "status.open",
  fixed: "status.fixed",
  pr_open: "status.pr_open",
  pr_merged: "status.pr_merged",
  false_positive: "status.false_positive",
  accepted_risk: "status.accepted_risk",
};

export interface FindingState {
  id: string;
  localId: string;
  status: FindingStatus;
  statusNote: string | null;
  inherited: boolean;
  hasFix: boolean;
}

export function isResolved(s: FindingStatus | undefined): boolean {
  return !!s && RESOLVED_STATUS.includes(s);
}

export function useFindings(analysisId: string, enabled: boolean) {
  const [byLocal, setByLocal] = useState<Record<string, FindingState>>({});
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const { items } = await apiGet<{ items: FindingState[] }>(
        `/api/analyses/${analysisId}/findings`
      );
      setByLocal(Object.fromEntries(items.map((i) => [i.localId, i])));
    } catch {
      // Análises anteriores à tabela `findings` não têm estado — a tela
      // simplesmente não mostra os controles.
    } finally {
      setLoaded(true);
    }
  }, [analysisId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Atualiza o estado com resposta otimista e desfaz se a API recusar. */
  const setStatus = useCallback(
    async (localId: string, status: FindingStatus, note?: string) => {
      const current = byLocal[localId];
      if (!current) return;
      const previous = current.status;
      setByLocal((m) => ({ ...m, [localId]: { ...current, status } }));
      try {
        await apiPatch(`/api/findings/${current.id}`, { status, note });
      } catch {
        setByLocal((m) => ({ ...m, [localId]: { ...current, status: previous } }));
      }
    },
    [byLocal]
  );

  return { byLocal, loaded, reload, setStatus };
}
