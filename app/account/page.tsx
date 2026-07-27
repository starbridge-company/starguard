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
      setError(e instanceof ApiError ? e.message : "Falha ao carregar os tokens.");
    } finally {
      setLoading(false);
    }
  }, [page]);

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
      setProfileOk("Nada para atualizar.");
      return;
    }
    if (body.email && !pCurrentPw) {
      setProfileError("Informe a senha atual para alterar o login (e-mail).");
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
      setProfileOk("Dados atualizados.");
    } catch (err) {
      setProfileError(
        err instanceof ApiError ? err.message : "Falha ao atualizar."
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwOk(null);
    if (!cpCurrent) return setPwError("Informe a senha atual.");
    if (cpNew.length < 8)
      return setPwError("A nova senha precisa de ao menos 8 caracteres.");
    if (cpNew !== cpConfirm) return setPwError("A confirmação não confere.");
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
      setPwOk("Senha alterada com sucesso.");
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Falha ao alterar a senha.");
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
      setOkMsg("Token salvo com segurança (cifrado).");
      setPage(1);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Falha ao salvar o token.");
    } finally {
      setSaving(false);
    }
  };

  const removeToken = async (id: string) => {
    if (!confirm("Remover este token? Análises futuras deixarão de poder usá-lo.")) return;
    setDeleting(id);
    try {
      await apiDelete(`/api/account/tokens/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao remover o token.");
    } finally {
      setDeleting(null);
    }
  };

  const tokens = data?.items || [];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <span className="page-kicker">Configurações</span>
          <h1>Conta</h1>
          <p className="page-subtitle">Seus dados de acesso e os tokens do GitHub.</p>
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

        <h3 className="section-subtitle">Dados básicos</h3>
        <form className="settings-form" onSubmit={saveProfile}>
          {profileError && <div className="alert error">{profileError}</div>}
          {profileOk && <div className="alert success">{profileOk}</div>}
          <div className="settings-grid">
            <div className="field">
              <label htmlFor="p-name">Nome</label>
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
                <span>Login (e-mail)</span>
                <InfoTip
                  title="Alterar o login"
                  content="Este e-mail é o seu login. Para alterá-lo, confirme com a senha atual. As próximas entradas usam o novo e-mail."
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
              <label htmlFor="p-current">Senha atual (para confirmar o novo login)</label>
              <input
                id="p-current"
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="sua senha atual"
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
              Salvar dados
            </button>
          </div>
        </form>

        <div className="settings-divider" />

        <h3 className="section-subtitle">
          <IconLock /> Alterar senha
        </h3>
        <form className="settings-form" onSubmit={savePassword}>
          {pwError && <div className="alert error">{pwError}</div>}
          {pwOk && <div className="alert success">{pwOk}</div>}
          <div className="field">
            <label htmlFor="cp-current">Senha atual</label>
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
              <label htmlFor="cp-new">Nova senha</label>
              <input
                id="cp-new"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="mínimo 8 caracteres"
                value={cpNew}
                onChange={(e) => setCpNew(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cp-confirm">Confirmar nova senha</label>
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
              Alterar senha
            </button>
          </div>
        </form>
      </section>

      {/* Tokens do GitHub */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title-row">
              <IconKey /> Tokens do GitHub
              <InfoTip
                title="Tokens cifrados"
                content="Os tokens são guardados cifrados (AES-256-GCM) e nunca voltam em texto puro. Mostramos apenas o nome e os últimos 4 caracteres. Você pode ter vários e escolher qual usar ao iniciar uma análise."
              />
            </h2>
            <p className="muted">
              Salvos cifrados; usados para clonar repositórios privados e abrir PRs.
            </p>
          </div>
        </div>

        <form className="token-form" onSubmit={addToken}>
          {formError && <div className="alert error">{formError}</div>}
          {okMsg && <div className="alert success">{okMsg}</div>}
          <div className="token-form-grid">
            <div className="field">
              <label htmlFor="tk-name">Nome</label>
              <input
                id="tk-name"
                className="input"
                placeholder="Ex.: PAT pessoal"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tk-token">Token</label>
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
              {saving ? <span className="button-spinner" /> : <IconPlus />} Salvar
            </button>
          </div>
        </form>

        {error && <div className="alert error">{error}</div>}

        {loading && !data ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : tokens.length === 0 ? (
          <div className="empty-state">Nenhum token salvo ainda.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Token</th>
                  <th>Criado</th>
                  <th>Último uso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-strong">{t.name}</td>
                    <td className="mono">••••{t.last4}</td>
                    <td className="muted">{fmtDate(t.createdAt)}</td>
                    <td className="muted">{fmtDate(t.lastUsedAt)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Remover"
                        disabled={deleting === t.id}
                        onClick={() => removeToken(t.id)}
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
