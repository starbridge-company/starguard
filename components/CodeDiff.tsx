"use client";

// Diff de revisão: mostra o que mudou, não o arquivo inteiro.
// Ver AUDITORIA.md#UX-02.
import { useMemo, useState } from "react";
import { diffLines, toChunks, diffStats } from "@/lib/diff";
import { useT } from "@/lib/i18n";

export default function CodeDiff({
  original,
  fixed,
  /** Altura máxima da área rolável. */
  maxHeight = 380,
}: {
  original: string;
  fixed: string;
  maxHeight?: number;
}) {
  const t = useT();
  const [mode, setMode] = useState<"diff" | "full">("diff");
  const [expandAll, setExpandAll] = useState(false);

  const lines = useMemo(() => diffLines(original, fixed), [original, fixed]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const chunks = useMemo(
    () => toChunks(lines, expandAll ? Number.MAX_SAFE_INTEGER : 3),
    [lines, expandAll]
  );

  const unchanged = stats.added === 0 && stats.removed === 0;

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-stats">
          <span className="text-success">+{stats.added}</span>{" "}
          <span className="text-danger">−{stats.removed}</span>
          {unchanged && <span className="muted"> · {t("diff.noChange")}</span>}
        </span>
        <span style={{ flex: 1 }} />
        {mode === "diff" && !unchanged && (
          <button
            type="button"
            className="button ghost small"
            onClick={() => setExpandAll((v) => !v)}
          >
            {expandAll ? t("diff.onlyChanges") : t("diff.showAll")}
          </button>
        )}
        <button
          type="button"
          className="button ghost small"
          onClick={() => setMode((m) => (m === "diff" ? "full" : "diff"))}
        >
          {mode === "diff" ? t("diff.fullFile") : t("diff.viewDiff")}
        </button>
      </div>

      {mode === "full" ? (
        <pre className="code-block" style={{ maxHeight, overflow: "auto" }}>
          {fixed}
        </pre>
      ) : (
        <div className="diff-body" style={{ maxHeight }}>
          {chunks.map((c, i) =>
            c.collapsed ? (
              <div className="diff-collapsed" key={`c${i}`}>
                ⋯ {t("diff.unchangedLines", { n: c.collapsed })}
              </div>
            ) : (
              c.lines.map((l, j) => (
                <div className={`diff-line ${l.type}`} key={`${i}-${j}`}>
                  <span className="diff-num">{l.aNum ?? ""}</span>
                  <span className="diff-num">{l.bNum ?? ""}</span>
                  <span className="diff-sign">
                    {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                  </span>
                  <span className="diff-text">{l.text || " "}</span>
                </div>
              ))
            )
          )}
        </div>
      )}
    </div>
  );
}
