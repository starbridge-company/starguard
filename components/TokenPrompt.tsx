"use client";

// ============================================================
// Pede o token do GitHub NA HORA em que ele é necessário — e só aí.
//
// O token do servidor deixou de agir em nome de qualquer usuário
// (AUDITORIA.md#SEC-06), então abrir PR sem token passou a falhar. Falhar é
// certo; falhar com um 502 genérico não é: quem está na tela tem como resolver
// em dois cliques, escolhendo um token que já salvou ou colando um novo.
//
// Não pedimos antes: a maior parte do fluxo (analisar repositório público, ler
// achados, gerar correção) não precisa de token nenhum.
// ============================================================
import { useEffect, useState } from "react";
import { Picker } from "@/components/filters";
import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { IconKey } from "@/lib/icons";

export interface TokenChoice {
  token?: string;
  tokenId?: string;
}

interface SavedToken {
  id: string;
  name: string;
  last4: string;
}

const NEW = "__new__";

export default function TokenPrompt({
  onRetry,
  busy,
}: {
  onRetry: (choice: TokenChoice) => void;
  busy?: boolean;
}) {
  const t = useT();
  const [saved, setSaved] = useState<SavedToken[]>([]);
  const [mode, setMode] = useState<string>(NEW);
  const [token, setToken] = useState("");

  useEffect(() => {
    apiGet<{ items: SavedToken[] }>("/api/account/tokens?pageSize=50")
      .then((r) => {
        setSaved(r.items);
        // Havendo token salvo, ele é o caminho mais curto — já vem escolhido.
        if (r.items.length) setMode(r.items[0]!.id);
      })
      .catch(() => setSaved([]));
  }, []);

  const usandoNovo = mode === NEW;
  const pronto = usandoNovo ? token.trim().length >= 8 : !!mode;

  return (
    // NÃO é `alert error`. Repositório privado pedir credencial não é falha —
    // é o passo normal do fluxo. Pintar de vermelho ensina que algo deu errado
    // quando nada deu, e faz o usuário hesitar em continuar.
    <div className="token-prompt">
      <div className="token-prompt-head">
        <IconKey />
        <div>
          <strong>{t("pr.tokenRequired")}</strong>
          <p className="muted">{t("pr.tokenPrivateHint")}</p>
        </div>
      </div>

      <Picker
        value={mode}
        ariaLabel={t("account.tokens")}
        icon={<IconKey />}
        onChange={setMode}
        options={[
          ...saved.map((s) => ({
            value: s.id,
            label: s.name,
            sub: `••••${s.last4}`,
            group: t("pr.savedTokens"),
          })),
          { value: NEW, label: t("pr.newToken") },
        ]}
      />

      {usandoNovo && (
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder="ghp_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      )}

      <div className="vuln-actions">
        <button
          type="button"
          className="button primary"
          disabled={!pronto || busy}
          aria-busy={busy}
          onClick={() =>
            onRetry(usandoNovo ? { token: token.trim() } : { tokenId: mode })
          }
        >
          {busy ? <span className="button-spinner" /> : null}
          {t("pr.retryWithToken")}
        </button>
        <span className="field-hint">{t("pr.tokenScopeHint")}</span>
      </div>
    </div>
  );
}
