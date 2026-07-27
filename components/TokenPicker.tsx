"use client";

// Seletor de token do GitHub na Nova Análise: usar um token salvo (cifrado)
// ou digitar um novo — com opção de salvá-lo na conta de forma transparente.
import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { Picker } from "@/components/filters";
import { apiGet } from "@/lib/client";
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
          <IconKey /> Token de acesso
        </span>
        <InfoTip
          title="Token do GitHub"
          content="Necessário só para repositórios privados / abrir PR. Escolha um token salvo (cifrado na sua conta) ou digite um novo. Um token novo pode ser salvo na conta para reutilizar — sempre cifrado, nunca em texto puro."
        />
      </label>

      {/* Popover próprio, no visual do site — a convenção declarada em
          components/filters.tsx. Ver AUDITORIA.md#UX-11. */}
      <Picker
        value={mode}
        ariaLabel="Token de acesso"
        icon={<IconKey />}
        onChange={selectMode}
        options={[
          { value: NONE, label: "Nenhum (repositório público)" },
          ...saved.map((t) => ({
            value: t.id,
            label: t.name,
            sub: `••••${t.last4}`,
            group: "Tokens salvos",
          })),
          { value: NEW, label: "+ Novo token…" },
        ]}
      />

      {mode === NEW && (
        <div className="token-inline">
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder="ghp_…"
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
            Salvar na conta (cifrado)
          </label>
          {value.saveToken && (
            <input
              className="input"
              placeholder="Nome do token (ex.: PAT pessoal)"
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
