"use client";

import { useState } from "react";
import type { FixTarget, FixResult, PullRequest } from "@/types";
import SeverityBadge from "@/components/SeverityBadge";
import InfoTip from "@/components/InfoTip";
import Modal from "@/components/Modal";
import CodeDiff from "@/components/CodeDiff";
import TokenPrompt, { type TokenChoice } from "@/components/TokenPrompt";
import { isGenericSuggestion } from "@/lib/constants";
import { useT } from "@/lib/i18n";
import {
  IconPullRequest,
  IconExternal,
  IconCheckCircle,
  IconRefactor,
} from "@/lib/icons";

// Instrução default já escrita na textarea ao abrir: a sugestão do scanner
// (só quando é específica) + a linha-guia, que entra uma única vez.
//
// A linha-guia vem do dicionário, não de `lib/constants`: ela é EDITADA pelo
// usuário na textarea, então precisa nascer no idioma dele.
function defaultInstructions(vuln: FixTarget, guide: string): string {
  const sug = vuln.suggestion?.trim();
  // A recomendação enriquecida é sempre mais útil que a do scanner.
  const melhor = vuln.explain?.howToFix?.trim() || sug;
  if (melhor && !isGenericSuggestion(melhor)) {
    return `${melhor}\n${guide}`;
  }
  return guide;
}

export default function FixModal({
  vuln,
  fix,
  loading,
  error,
  onGenerate,
  onClose,
  onOpenPR,
  prState,
  pr,
  canOpenPR,
  needToken,
  onRetryWithToken,
  repoIsPrivate,
}: {
  vuln: FixTarget;
  fix: FixResult | null;
  loading: boolean;
  error?: string | null;
  onGenerate: (instructions: string) => void;
  onClose: () => void;
  onOpenPR: () => void;
  prState: "idle" | "loading" | "done";
  pr: PullRequest | null;
  canOpenPR: boolean;
  /** Mensagem do servidor quando o PR falhou por falta de token. */
  needToken?: string | null;
  onRetryWithToken?: (choice: TokenChoice) => void;
  /** Privado exige token do usuário — o seletor aparece antes do clique. */
  repoIsPrivate?: boolean | null;
}) {
  const t = useT();
  const guide = t("fix.guide");
  const [instructions, setInstructions] = useState(() =>
    defaultInstructions(vuln, guide)
  );

  // Clicar fora não pode custar trabalho. A correção em si já não se perde —
  // o FEAT-02 a guarda no banco e ela volta ao reabrir o modal. O que ainda
  // some é o que o usuário DIGITOU e não chegou a usar: instruções alteradas
  // e nunca enviadas. Só nesse caso perguntamos. Ver AUDITORIA.md#UX-03.
  const instructionsDirty =
    instructions.trim() !== defaultInstructions(vuln, guide).trim();
  const confirmClose = () =>
    instructionsDirty && !fix ? t("fix.confirmDiscard") : null;

  return (
    <Modal
      title={t("fix.title")}
      locked={loading}
      confirmClose={confirmClose}
      onClose={onClose}
      titleExtra={
        <div className="vuln-badges" style={{ marginLeft: 8 }}>
          <SeverityBadge severity={vuln.severity} />
          <span className="badge">{vuln.ruleId}</span>
          <span className="muted">
            {vuln.file}:{vuln.line}
            {vuln.endLine && vuln.endLine !== vuln.line ? `–${vuln.endLine}` : ""}
          </span>
        </div>
      }
    >
      {/* O problema — a "realidade" do erro enviada à IA */}
      <div className="vuln-suggestion">
        <span className="label">{t("fix.problem")}</span>
        {vuln.description || vuln.title}
        <div className="vuln-meta" style={{ marginTop: 8 }}>
          {vuln.cwe && <span className="meta-item">{vuln.cwe}</span>}
          {vuln.owasp && <span className="meta-item">{vuln.owasp}</span>}
          <span className="meta-item mono">{vuln.ruleId}</span>
        </div>
        {vuln.codeSnippet && (
          <pre className="code-block" style={{ marginTop: 8 }}>
            {vuln.codeSnippet}
          </pre>
        )}
      </div>

      {/* Prompt personalizável por quem está na tela */}
      <div className="field">
        <label htmlFor="fix-instructions" className="field-label-row">
          {t("fix.instructions")}
          <InfoTip
            title={t("help.customizeFix")}
            content={t("help.customizeFixText")}
          />
        </label>
        <textarea
          id="fix-instructions"
          className="textarea"
          style={{ minHeight: 80 }}
          placeholder={t("fix.instructionsPlaceholder")}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div className="vuln-actions">
          <button
            type="button"
            className={fix ? "button ghost" : "button primary"}
            onClick={() => onGenerate(instructions)}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <span className="button-spinner" /> : <IconRefactor />}
            {fix ? t("fix.regenerate") : t("fix.generate")}
          </button>
          {fix && (
            <span className="field-hint">
              {t("fix.regenerateHint")}
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className="empty-state">
          <div
            className="button-spinner"
            style={{ borderTopColor: "hsl(var(--accent))" }}
          />
          <p>{t("fix.generating")}</p>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {fix && !loading && (
        <>
          {fix.noChange && (
            <div className="alert error">
              {t("fix.noChange")}
            </div>
          )}

          <div className="vuln-suggestion">
            <span className="label">{t("fix.whatChanged")}</span>
            {fix.explanation}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span className="field-label text-accent">
              {t("fix.changesIn", { file: fix.file })}
            </span>
            <CodeDiff original={fix.originalCode} fixed={fix.fixedCode} />
            <span className="field-hint">
              {fix.usedWholeFile
                ? t("fix.wholeFile")
                : t("fix.snippetOnly")}
            </span>
          </div>

          {fix.changedFiles && fix.changedFiles.length > 1 && (
            <div className="alert info">
              {t("fix.multiFile", {
                n: fix.changedFiles.length,
                files: fix.changedFiles.map((c) => c.file).join(", "),
              })}
            </div>
          )}

          {pr ? (
            <div className="alert success">
              <IconCheckCircle />
              <span>
                {t("fix.prOpened", { number: pr.number, branch: pr.branch })}{" "}
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="link"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  {t("fix.viewOnGithub")} <IconExternal />
                </a>
              </span>
            </div>
          ) : (needToken !== null && needToken !== undefined) || repoIsPrivate ? (
            // A correção já está gerada e guardada — falta só a credencial.
            <TokenPrompt
              busy={prState === "loading"}
              onRetry={onRetryWithToken!}
            />
          ) : (
            <div className="vuln-actions">
              <button
                type="button"
                className="button primary"
                onClick={onOpenPR}
                disabled={!canOpenPR || fix.noChange || prState === "loading"}
                aria-busy={prState === "loading"}
              >
                {prState === "loading" ? (
                  <span className="button-spinner" />
                ) : (
                  <IconPullRequest />
                )}
                {t("fix.openPr")}
              </button>
              {!canOpenPR && (
                <span className="field-hint">
                  {t("fix.needRepo")}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
