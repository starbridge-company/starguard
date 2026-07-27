"use client";

import InfoTip from "@/components/InfoTip";
import { parseGitHubRepo } from "@/lib/validation";
import { useT } from "@/lib/i18n";
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
  const t = useT();
  // Mesma função que o servidor usa (`lib/validation.ts` é isomórfico): assim
  // a regra é uma só e o erro aparece no campo, não depois do envio.
  // Campo vazio é válido — o repositório é opcional. Ver AUDITORIA.md#UX-19.
  const typed = repoUrl.trim();
  const invalid = typed.length > 0 && parseGitHubRepo(typed) === null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="field">
        <label htmlFor="repo-url" className="field-label-row">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconRepo /> {t("repo.label")}
          </span>
          <InfoTip title={t("repo.help")} content={t("repo.helpText")} />
        </label>
        <input
          id="repo-url"
          className={`input ${invalid ? "is-invalid" : ""}`}
          type="url"
          inputMode="url"
          placeholder={t("repo.placeholder")}
          value={repoUrl}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "repo-url-error" : undefined}
          onChange={(e) => onRepoUrl(e.target.value)}
        />
        {invalid && (
          <span id="repo-url-error" className="field-hint error" role="alert">
            {t("repo.invalid")}
          </span>
        )}
      </div>

      {!hideToken && (
        <div className="field">
          <label htmlFor="repo-token" className="field-label-row">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconKey /> {t("repo.tokenLabel")}
            </span>
            <InfoTip
              title={t("repo.tokenHelp")}
              content={t("repo.tokenHelpText")}
            />
          </label>
          <input
            id="repo-token"
            className="input"
            type="password"
            autoComplete="off"
            placeholder={t("repo.tokenPlaceholder")}
            value={token || ""}
            onChange={(e) => onToken?.(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
