"use client";

import { useState } from "react";
import type { Vulnerability, FixResult, PullRequest } from "@/types";
import SeverityBadge from "@/components/SeverityBadge";
import InfoTip from "@/components/InfoTip";
import {
  IconX,
  IconPullRequest,
  IconExternal,
  IconCheckCircle,
  IconRefactor,
} from "@/lib/icons";

// Instrução default já escrita na textarea ao abrir — reaproveita a sugestão do
// scanner (só quando é específica) + a orientação de não quebrar lógica. Nunca
// duplica: a linha-guia entra uma única vez.
function defaultInstructions(vuln: Vulnerability): string {
  const guide =
    "Corrija apenas este problema de segurança, sem alterar a lógica de negócio, mantendo o estilo e a indentação do arquivo.";
  const generic = /^Revise o trecho conforme a regra/i;
  const sug = vuln.suggestion?.trim();
  if (sug && !generic.test(sug) && sug.toLowerCase() !== guide.toLowerCase()) {
    return `${sug}\n${guide}`;
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
}: {
  vuln: Vulnerability;
  fix: FixResult | null;
  loading: boolean;
  error?: string | null;
  onGenerate: (instructions: string) => void;
  onClose: () => void;
  onOpenPR: () => void;
  prState: "idle" | "loading" | "done";
  pr: PullRequest | null;
  canOpenPR: boolean;
}) {
  const [instructions, setInstructions] = useState(() =>
    defaultInstructions(vuln)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Corrigir com IA</h2>
            <div className="vuln-badges" style={{ marginTop: 8 }}>
              <SeverityBadge severity={vuln.severity} />
              <span className="badge">{vuln.ruleId}</span>
              <span className="muted">
                {vuln.file}:{vuln.line}
                {vuln.endLine && vuln.endLine !== vuln.line ? `–${vuln.endLine}` : ""}
              </span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            <IconX />
          </button>
        </div>

        {/* O problema — a "realidade" do erro enviada à IA */}
        <div className="vuln-suggestion">
          <span className="label">O problema</span>
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
            Instruções para a IA (opcional)
            <InfoTip
              title="Personalize a correção"
              content="Oriente a IA: biblioteca a usar, manter a assinatura de uma função, seguir um padrão do projeto, etc. A IA recebe o arquivo inteiro + o contexto do erro e corrige só o problema de segurança, sem mudar a lógica de negócio."
            />
          </label>
          <textarea
            id="fix-instructions"
            className="textarea"
            style={{ minHeight: 80 }}
            placeholder="Ex.: use consultas parametrizadas do driver pg, mantenha a assinatura da função e o estilo do arquivo. Não altere as outras rotas."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <div className="vuln-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => onGenerate(instructions)}
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? <span className="button-spinner" /> : <IconRefactor />}
              {fix ? "Refazer com estas instruções" : "Gerar correção"}
            </button>
          </div>
        </div>

        {loading && (
          <div className="empty-state">
            <div
              className="button-spinner"
              style={{ borderTopColor: "hsl(var(--accent))" }}
            />
            <p>Gerando correção com IA…</p>
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        {fix && !loading && (
          <>
            <div className="vuln-suggestion">
              <span className="label">O que mudou e por quê</span>
              {fix.explanation}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <span className="field-label text-accent">
                {fix.usedWholeFile ? "Arquivo corrigido (completo)" : "Código corrigido"}
              </span>
              <pre
                className="code-block"
                style={{ maxHeight: 360, overflow: "auto" }}
              >
                {fix.fixedCode}
              </pre>
              <span className="field-hint">
                {fix.usedWholeFile
                  ? "A IA recebeu o arquivo inteiro; o PR grava este conteúdo completo."
                  : "A IA recebeu apenas o trecho — não foi possível buscar o arquivo inteiro."}
              </span>
            </div>

            {pr ? (
              <div className="alert success">
                <IconCheckCircle />
                <span>
                  PR #{pr.number} aberto ({pr.branch}).{" "}
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
              <div className="vuln-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={onOpenPR}
                  disabled={!canOpenPR || prState === "loading"}
                  aria-busy={prState === "loading"}
                >
                  {prState === "loading" ? (
                    <span className="button-spinner" />
                  ) : (
                    <IconPullRequest />
                  )}
                  Abrir PR no GitHub
                </button>
                {!canOpenPR && (
                  <span className="field-hint">
                    Informe a URL do repositório na Tela 1 para abrir PR.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
