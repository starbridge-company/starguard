"use client";

import InfoTip from "@/components/InfoTip";
import { IconRepo, IconKey } from "@/lib/icons";

export default function RepoInput({
  repoUrl,
  token,
  onRepoUrl,
  onToken,
  hideToken = false,
}: {
  repoUrl: string;
  token?: string;
  onRepoUrl: (v: string) => void;
  onToken?: (v: string) => void;
  hideToken?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="field">
        <label htmlFor="repo-url" className="field-label-row">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconRepo /> Repositório GitHub
          </span>
          <InfoTip
            title="URL do repositório"
            content="Somente github.com é aceito (allowlist anti-SSRF). Sem repositório, a Fase 3 (scan de código) não roda — as demais fases seguem normalmente."
          />
        </label>
        <input
          id="repo-url"
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://github.com/starbridge/meu-projeto"
          value={repoUrl}
          onChange={(e) => onRepoUrl(e.target.value)}
        />
      </div>

      {!hideToken && (
        <div className="field">
          <label htmlFor="repo-token" className="field-label-row">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconKey /> Token de acesso
            </span>
            <InfoTip
              title="Personal Access Token"
              content="Necessário apenas para repositórios privados. O token vive só em memória durante o job e nunca é persistido nem devolvido ao cliente."
            />
          </label>
          <input
            id="repo-token"
            className="input"
            type="password"
            autoComplete="off"
            placeholder="ghp_… (opcional)"
            value={token || ""}
            onChange={(e) => onToken?.(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
