"use client";

// Seletor de token do GitHub na Nova Análise: usar um token salvo (cifrado)
// ou digitar um novo — com opção de salvá-lo na conta de forma transparente.
import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { Picker } from "@/components/filters";
import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { IconKey } from "@/lib/icons";

export interface TokenSelection {
  tokenId?: string;
  token?: string;
  saveToken?: boolean;
  tokenName?: string;
}

interface SavedToken {
  id: string;
  name: string;
  last4: string;
}

const NEW = "__new__";
const NONE = "";

export default function TokenPicker({
  value,
  onChange,
}: {
  value: TokenSelection;
  onChange: (v: TokenSelection) => void;
}) {
  const t = useT();
  const [saved, setSaved] = useState<SavedToken[]>([]);
  const [mode, setMode] = useState<string>(NONE); // NONE | NEW | <tokenId>

  useEffect(() => {
    apiGet<{ items: SavedToken[] }>("/api/account/tokens?pageSize=50")
      .then((r) => setSaved(r.items))
      .catch(() => setSaved([]));
  }, []);

  const selectMode = (m: string) => {
    setMode(m);
    if (m === NONE) onChange({});
    else if (m === NEW)
      onChange({ token: value.token, saveToken: value.saveToken, tokenName: value.tokenName });
    else onChange({ tokenId: m });
  };

  return (
    <div className="field">
      <label className="field-label-row">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <IconKey /> {t("repo.tokenLabel")}
        </span>
        <InfoTip
          title={t("tokenPicker.help")}
          content={t("tokenPicker.helpText")}
        />
      </label>

      {/* Popover próprio, no visual do site — a convenção declarada em
          components/filters.tsx. Ver AUDITORIA.md#UX-11. */}
      <Picker
        value={mode}
        ariaLabel={t("repo.tokenLabel")}
        icon={<IconKey />}
        onChange={selectMode}
        options={[
          { value: NONE, label: t("tokenPicker.none") },
          ...saved.map((tk) => ({
            value: tk.id,
            label: tk.name,
            sub: `••••${tk.last4}`,
            group: t("pr.savedTokens"),
          })),
          { value: NEW, label: t("tokenPicker.new") },
        ]}
      />

      {mode === NEW && (
        <div className="token-inline">
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={t("account.tokenPlaceholder")}
            value={value.token || ""}
            onChange={(e) =>
              onChange({ ...value, tokenId: undefined, token: e.target.value })
            }
          />
          <label className="check-inline">
            <input
              type="checkbox"
              checked={!!value.saveToken}
              onChange={(e) => onChange({ ...value, saveToken: e.target.checked })}
            />
            {t("tokenPicker.saveToAccount")}
          </label>
          {value.saveToken && (
            <input
              className="input"
              placeholder={t("tokenPicker.namePlaceholder")}
              value={value.tokenName || ""}
              maxLength={100}
              onChange={(e) => onChange({ ...value, tokenName: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
}
