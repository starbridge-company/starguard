"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { Segmented } from "@/components/filters";
import { useI18n } from "@/lib/i18n";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/config";
import Pagination from "@/components/Pagination";
import InfoTip from "@/components/InfoTip";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/client";
import type { Paged } from "@/lib/pagination";
import { useMe, clearMe } from "@/lib/useMe";
import { fmtDate, RoleBadge } from "@/components/listing";
import { IconKey, IconPlus, IconTrash, IconUser, IconLock } from "@/lib/icons";

interface TokenView {
  id: string;
  name: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Profile {
  name: string;
  email: string;
  role: string;
}

export default function AccountPage() {
  const { locale, setLocale, t } = useI18n();
  const { me } = useMe();

  // ---- Perfil (nome + login) ----
  const [display, setDisplay] = useState<Profile | null>(null);
  const [pName, setPName] = useState("");
  const [pEmail, setPEmail] = useState("");
  const [pCurrentPw, setPCurrentPw] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState<string | null>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (me && !inited.current) {
      inited.current = true;
      setDisplay({ name: me.name, email: me.email, role: me.role });
      setPName(me.name);
      setPEmail(me.email);
    }
  }, [me]);

  // ---- Senha ----
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);

  // ---- Tokens ----
  const [data, setData] = useState<Paged<TokenView> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "10" });
      setData(await apiGet<Paged<TokenView>>(`/api/account/tokens?${params}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("account.loadTokensFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  useEffect(() => {
    load();
  }, [load]);

  const emailChanged =
    !!display && pEmail.trim().toLowerCase() !== display.email.toLowerCase();
  const nameChanged = !!display && pName.trim() !== display.name;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileOk(null);
    if (!display) return;
    const body: Record<string, string> = {};
    if (nameChanged && pName.trim()) body.name = pName.trim();
    if (emailChanged && pEmail.trim()) body.email = pEmail.trim();
    if (Object.keys(body).length === 0) {
      setProfileOk(t("account.nothingToUpdate"));
      return;
    }
    if (body.email && !pCurrentPw) {
      setProfileError(t("account.needCurrentPassword"));
      return;
    }
    if (pCurrentPw) body.currentPassword = pCurrentPw;
    setSavingProfile(true);
    try {
      const updated = await apiPatch<Profile>("/api/account/profile", body);
      setDisplay({ name: updated.name, email: updated.email, role: updated.role });
      setPName(updated.name);
      setPEmail(updated.email);
      setPCurrentPw("");
      clearMe();
      setProfileOk(t("account.profileUpdated"));
    } catch (err) {
      setProfileError(
        err instanceof ApiError ? err.message : t("account.updateFailed")
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwOk(null);
    if (!cpCurrent) return setPwError(t("account.enterCurrentPassword"));
    if (cpNew.length < 8)
      return setPwError(t("account.newPasswordTooShort"));
    if (cpNew !== cpConfirm) return setPwError(t("account.confirmMismatch"));
    setSavingPw(true);
    try {
      await apiPatch("/api/account/profile", {
        currentPassword: cpCurrent,
        newPassword: cpNew,
      });
      setCpCurrent("");
      setCpNew("");
      setCpConfirm("");
      clearMe();
      setPwOk(t("account.passwordChanged"));
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : t("account.changePasswordFailed"));
    } finally {
      setSavingPw(false);
    }
  };

  const addToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !token.trim()) return;
    setSaving(true);
    setFormError(null);
    setOkMsg(null);
    try {
      await apiPost("/api/account/tokens", { name: name.trim(), token: token.trim() });
      setName("");
      setToken("");
      setOkMsg(t("account.tokenSaved"));
      setPage(1);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("account.saveTokenFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeToken = async (id: string) => {
    if (!confirm(t("account.removeTokenConfirm"))) return;
    setDeleting(id);
    try {
      await apiDelete(`/api/account/tokens/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("account.removeTokenFailed"));
    } finally {
      setDeleting(null);
    }
  };

  const tokens = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">{t("account.kicker")}</span>
          <h1>{t("nav.account")}</h1>
          <p className="page-subtitle">{t("account.subtitle")}</p>
        </div>
      </header>

      {/* Idioma — vale para a interface E para o que a IA escreve.
          Ver AUDITORIA.md#FEAT-04. */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title-row">{t("account.language")}</h2>
            <p className="muted">{t("account.languageHint")}</p>
          </div>
        </div>
        <Segmented
          options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABEL[l] }))}
          value={locale}
          onChange={(v) => {
            // Grava na CONTA antes de recarregar: assim a preferência
            // acompanha o usuário em qualquer máquina (AUDITORIA.md#PEND-19).
            // Falha aqui não impede a troca local — o cookie já resolve a sessão.
            void apiPatch("/api/account/profile", { locale: v }).catch(() => {});
            setLocale(v as (typeof LOCALES)[number]);
          }}
          ariaLabel={t("common.language")}
        />
      </section>

      {/* Configurações básicas — perfil + login + senha */}
      <section className="panel">
        <div className="profile-row">
          <div className="profile-avatar">
            <IconUser />
          </div>
          <div className="profile-info">
            <strong>{display?.name || me?.name || "—"}</strong>
            <span className="muted">{display?.email || me?.email || ""}</span>
          </div>
          {(display || me) && <RoleBadge role={display?.role || me!.role} />}
        </div>

        <h3 className="section-subtitle">{t("account.basics")}</h3>
        <form className="settings-form" onSubmit={saveProfile}>
          {profileError && <div className="alert error">{profileError}</div>}
          {profileOk && <div className="alert success">{profileOk}</div>}
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="p-name">{t("account.name")}</label>
              <input
                id="p-name"
                className="input"
                value={pName}
                maxLength={120}
                onChange={(e) => setPName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="p-email" className="field-label-row">
                <span>{t("account.login")}</span>
                <InfoTip
                  title={t("account.loginHelp")}
                  content={t("account.loginHelpText")}
                />
              </label>
              <input
                id="p-email"
                className="input"
                type="email"
                autoComplete="off"
                value={pEmail}
                onChange={(e) => setPEmail(e.target.value)}
              />
            </div>
          </div>
          {emailChanged && (
            <div className="field">
              <label htmlFor="p-current">{t("account.currentPasswordToConfirm")}</label>
              <input
                id="p-current"
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder={t("account.currentPasswordPlaceholder")}
                value={pCurrentPw}
                onChange={(e) => setPCurrentPw(e.target.value)}
              />
            </div>
          )}
          <div className="settings-actions">
            <button
              type="submit"
              className="button primary"
              disabled={savingProfile || (!nameChanged && !emailChanged)}
              aria-busy={savingProfile}
            >
              {savingProfile ? <span className="button-spinner" /> : null}
              {t("account.saveProfile")}
            </button>
          </div>
        </form>

        <div className="settings-divider" />

        <h3 className="section-subtitle">
          <IconLock /> {t("account.changePassword")}
        </h3>
        <form className="settings-form" onSubmit={savePassword}>
          {pwError && <div className="alert error">{pwError}</div>}
          {pwOk && <div className="alert success">{pwOk}</div>}
          <div className="field">
            <label htmlFor="cp-current">{t("account.currentPassword")}</label>
            <input
              id="cp-current"
              className="input"
              type="password"
              autoComplete="current-password"
              value={cpCurrent}
              onChange={(e) => setCpCurrent(e.target.value)}
            />
          </div>
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="cp-new">{t("account.newPassword")}</label>
              <input
                id="cp-new"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={t("account.min8")}
                value={cpNew}
                onChange={(e) => setCpNew(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cp-confirm">{t("account.confirmNewPassword")}</label>
              <input
                id="cp-confirm"
                className="input"
                type="password"
                autoComplete="new-password"
                value={cpConfirm}
                onChange={(e) => setCpConfirm(e.target.value)}
              />
            </div>
          </div>
          <div className="settings-actions">
            <button
              type="submit"
              className="button primary"
              disabled={savingPw || !cpCurrent || !cpNew || !cpConfirm}
              aria-busy={savingPw}
            >
              {savingPw ? <span className="button-spinner" /> : null}
              {t("account.changePassword")}
            </button>
          </div>
        </form>
      </section>

      {/* Tokens do GitHub */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title-row">
              <IconKey /> {t("account.tokens")}
              <InfoTip
                title={t("account.tokensHelp")}
                content={t("account.tokensHelpText")}
              />
            </h2>
            <p className="muted">{t("account.tokensHint")}</p>
          </div>
        </div>

        <form className="token-form" onSubmit={addToken}>
          {formError && <div className="alert error">{formError}</div>}
          {okMsg && <div className="alert success">{okMsg}</div>}
          <div className="token-form-grid">
            <div className="field">
              <label htmlFor="tk-name">{t("account.name")}</label>
              <input
                id="tk-name"
                className="input"
                placeholder={t("account.tokenNamePlaceholder")}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tk-token">{t("account.token")}</label>
              <input
                id="tk-token"
                className="input"
                type="password"
                autoComplete="off"
                placeholder="ghp_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="button primary"
              disabled={saving || !name.trim() || !token.trim()}
              aria-busy={saving}
            >
              {saving ? <span className="button-spinner" /> : <IconPlus />} {t("account.save")}
            </button>
          </div>
        </form>

        {error && <div className="alert error">{error}</div>}

        {loading && !data ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : tokens.length === 0 ? (
          <div className="empty-state">{t("account.noTokens")}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("account.name")}</th>
                  <th>{t("account.token")}</th>
                  <th>{t("account.createdAt")}</th>
                  <th>{t("account.lastUsed")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {/* `tk`, não `t`: o `t` deste escopo é a função de tradução. */}
                {tokens.map((tk) => (
                  <tr key={tk.id}>
                    <td className="cell-strong">{tk.name}</td>
                    <td className="mono">••••{tk.last4}</td>
                    <td className="muted">{fmtDate(tk.createdAt)}</td>
                    <td className="muted">{fmtDate(tk.lastUsedAt)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="icon-btn danger"
                        title={t("account.remove")}
                        disabled={deleting === tk.id}
                        onClick={() => removeToken(tk.id)}
                      >
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <Pagination
            page={data.page}
            pageCount={data.pageCount}
            total={data.total}
            onPage={setPage}
          />
        )}
      </section>
    </AppShell>
  );
}
