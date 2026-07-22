"use client";

import { useEffect, useState } from "react";
import type { Vulnerability, FixResult } from "@/types";
import SeverityBadge from "@/components/SeverityBadge";
import InfoTip from "@/components/InfoTip";
import { apiPost, ApiError } from "@/lib/client";
import {
  IconX,
  IconCheck,
  IconPullRequest,
  IconExternal,
  IconCheckCircle,
  IconChevronDown,
} from "@/lib/icons";

type ItemStatus = "queued" | "running" | "done" | "error";
interface ItemState {
  status: ItemStatus;
  fix?: FixResult;
  error?: string;
}

interface BatchPR {
  number: number;
  url: string;
  branch: string;
  committed: number;
}

const CONCURRENCY = 3;

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: "Na fila",
  running: "Gerando…",
  done: "Pronta",
  error: "Erro",
};

const EXT_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  php: "php",
  cs: "csharp",
};

function guessLang(file: string): string | undefined {
  const ext = file.split(".").pop()?.toLowerCase();
  return ext ? EXT_LANG[ext] : undefined;
}

export default function BatchFixModal({
  vulns,
  repoUrl,
  analysisId,
  onClose,
}: {
  vulns: Vulnerability[];
  repoUrl?: string;
  analysisId?: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(vulns.map((v) => [v.id, { status: "queued" as ItemStatus }]))
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [prState, setPrState] = useState<"idle" | "loading" | "done">("idle");
  const [pr, setPr] = useState<BatchPR | null>(null);
  const [prError, setPrError] = useState<string | null>(null);

  // Gera as correções em paralelo (pool de workers) assim que abre.
  useEffect(() => {
    let cancelled = false;
    const queue = [...vulns];
    const setItem = (id: string, patch: Partial<ItemState>) =>
      setItems((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    async function worker() {
      while (queue.length && !cancelled) {
        const v = queue.shift()!;
        setItem(v.id, { status: "running" });
        try {
          const fix = await apiPost<FixResult>("/api/step4-fix", {
            vulnerabilityId: v.id,
            file: v.file,
            originalCode: v.codeSnippet || v.description || v.title,
            description: v.description || v.title,
            suggestion: v.suggestion,
            language: guessLang(v.file),
            line: v.line,
            endLine: v.endLine,
            cwe: v.cwe,
            owasp: v.owasp,
            ruleId: v.ruleId,
            repoUrl,
          });
          if (!cancelled) setItem(v.id, { status: "done", fix });
        } catch (err) {
          if (!cancelled)
            setItem(v.id, {
              status: "error",
              error: err instanceof ApiError ? err.message : "Falha ao gerar.",
            });
        }
      }
    }

    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, vulns.length) }, worker)
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const states = vulns.map((v) => items[v.id]);
  const doneCount = states.filter((s) => s?.status === "done").length;
  const errorCount = states.filter((s) => s?.status === "error").length;
  const pending = states.filter(
    (s) => s?.status === "queued" || s?.status === "running"
  ).length;
  const generating = pending > 0;
  const total = vulns.length;
  const pct = Math.round(((doneCount + errorCount) / total) * 100);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openBatchPR = async () => {
    if (!repoUrl) return;
    const files = vulns
      .map((v) => items[v.id])
      .filter((s): s is ItemState & { fix: FixResult } => s?.status === "done" && !!s.fix)
      .map((s) => ({ file: s.fix.file, fixedCode: s.fix.fixedCode }));
    if (!files.length) return;

    setPrState("loading");
    setPrError(null);
    try {
      const body = [
        `Correções de segurança geradas pelo StarGuard (${files.length}).`,
        "",
        ...vulns
          .map((v) => items[v.id])
          .filter((s) => s?.status === "done" && s.fix)
          .map((s) => `- \`${s.fix!.file}\`: ${s.fix!.explanation}`),
        "",
        "Revise cada alteração antes de mergear.",
      ].join("\n");

      const result = await apiPost<BatchPR>("/api/github/pr-batch", {
        repoUrl,
        files,
        title: `Correções de segurança StarGuard (${files.length})`,
        body,
        analysisId,
      });
      setPr(result);
      setPrState("done");
    } catch (err) {
      setPrError(err instanceof ApiError ? err.message : "Falha ao abrir o PR.");
      setPrState("idle");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="panel-title-row">
              Corrigir em lote
              <InfoTip
                title="Como funciona"
                content="A IA gera uma correção para cada vulnerabilidade selecionada, em paralelo. Ao final, você abre um único Pull Request no GitHub com todas elas. Cada correção consome uma chamada de IA."
              />
            </h2>
            <p className="muted" style={{ marginTop: 6 }}>
              {generating
                ? `Gerando correções… ${doneCount}/${total}`
                : `${doneCount} pronta(s)${errorCount ? ` · ${errorCount} com erro` : ""} de ${total}`}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            <IconX />
          </button>
        </div>

        <div className="progress-track" aria-label="progresso das correções">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="batch-list">
          {vulns.map((v) => {
            const s = items[v.id];
            const isOpen = expanded.has(v.id);
            return (
              <div key={v.id} className={`batch-item is-${s?.status}`}>
                <div className="batch-item-head">
                  <span className={`batch-chip ${s?.status}`}>
                    {s?.status === "done" ? (
                      <IconCheck />
                    ) : s?.status === "error" ? (
                      <IconX />
                    ) : s?.status === "running" ? (
                      <span className="button-spinner" />
                    ) : (
                      <span className="dot" />
                    )}
                    {STATUS_LABEL[s?.status ?? "queued"]}
                  </span>
                  <SeverityBadge severity={v.severity} />
                  <span className="batch-item-title">{v.title}</span>
                  <span className="muted mono batch-item-loc">
                    {v.file}:{v.line}
                  </span>
                  {s?.status === "done" && (
                    <button
                      type="button"
                      className={`batch-toggle ${isOpen ? "is-open" : ""}`}
                      onClick={() => toggle(v.id)}
                    >
                      ver diff <IconChevronDown />
                    </button>
                  )}
                </div>

                {/* Problema que esta correção resolve */}
                {v.description && (
                  <p className="batch-item-desc">{v.description}</p>
                )}

                {s?.status === "error" && (
                  <div className="batch-item-error">{s.error}</div>
                )}

                {s?.status === "done" && isOpen && s.fix && (
                  <div className="batch-diff">
                    <span className="field-label">Código original</span>
                    <pre className="code-block">{s.fix.originalCode}</pre>
                    <span className="field-label text-accent">Código corrigido</span>
                    <pre className="code-block">{s.fix.fixedCode}</pre>
                    <div className="vuln-suggestion">
                      <span className="label">O que mudou</span>
                      {s.fix.explanation}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Rodapé — abrir 1 PR com todas */}
        {pr ? (
          <div className="alert success">
            <IconCheckCircle />
            <span>
              PR #{pr.number} aberto com {pr.committed} arquivo(s).{" "}
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="link"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                Ver no GitHub <IconExternal />
              </a>
            </span>
          </div>
        ) : (
          <div className="batch-footer">
            {prError && <div className="alert error">{prError}</div>}
            {repoUrl ? (
              <button
                type="button"
                className="button primary"
                onClick={openBatchPR}
                disabled={generating || doneCount === 0 || prState === "loading"}
                aria-busy={prState === "loading"}
              >
                {prState === "loading" ? (
                  <span className="button-spinner" />
                ) : (
                  <IconPullRequest />
                )}
                {generating
                  ? "Aguarde as correções…"
                  : `Abrir 1 PR com ${doneCount} correç${doneCount === 1 ? "ão" : "ões"}`}
              </button>
            ) : (
              <span className="field-hint">
                Informe a URL do repositório na Tela 1 para abrir o PR. As
                correções acima já podem ser revisadas.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
