"use client";

import { useState } from "react";
import InfoTip from "@/components/InfoTip";
import Modal from "@/components/Modal";
import { Picker } from "@/components/filters";
import { apiPost } from "@/lib/client";
import { useApiError, useT } from "@/lib/i18n";
import { IconUser } from "@/lib/icons";

export default function NewUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const apiError = useApiError();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "superadmin">("admin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !!name.trim() && !!email.trim() && password.length >= 8 && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/admin/users", {
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      });
      onCreated();
    } catch (err) {
      setError(apiError(err, "newUser.failed"));
      setSaving(false);
    }
  };

  // Era a última <div> com onClick no overlay: sem role, sem ESC, sem
  // armadilha de foco e sem trava de rolagem — e um clique fora jogava fora o
  // formulário preenchido. Ver AUDITORIA.md#UX-04 e #UX-03.
  const dirty = !!(name || email || password);

  return (
    <Modal
      title={
        <>
          <IconUser /> {t("newUser.title")}
          <InfoTip title={t("newUser.help")} content={t("newUser.helpText")} />
        </>
      }
      locked={saving}
      confirmClose={() => (dirty ? t("newUser.confirmDiscard") : null)}
      onClose={onClose}
    >
      <p className="muted" style={{ marginTop: 4 }}>
        {t("newUser.subtitle")}
      </p>

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="nu-name">{t("newUser.name")}</label>
          <input
            id="nu-name"
            className="input"
            placeholder={t("newUser.namePlaceholder")}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="nu-email">{t("newUser.email")}</label>
          <input
            id="nu-email"
            className="input"
            type="email"
            autoComplete="off"
            placeholder={t("newUser.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="nu-password">{t("newUser.password")}</label>
          <input
            id="nu-password"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={t("newUser.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password.length > 0 && password.length < 8 && (
            <span className="field-hint error">{t("newUser.passwordTooShort")}</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="nu-role">{t("newUser.role")}</label>
          {/* Popover próprio em vez do <select> nativo (AUDITORIA.md#UX-11). */}
          <Picker
            id="nu-role"
            value={role}
            ariaLabel={t("newUser.role")}
            onChange={(v) => setRole(v as "admin" | "superadmin")}
            options={[
              {
                value: "admin",
                label: t("role.admin"),
                sub: t("newUser.roleAdminSub"),
              },
              {
                value: "superadmin",
                label: t("role.superadmin"),
                sub: t("newUser.roleSuperadminSub"),
              },
            ]}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="button ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!canSubmit}
            aria-busy={saving}
          >
            {saving ? <span className="button-spinner" /> : null}
            {t("newUser.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
