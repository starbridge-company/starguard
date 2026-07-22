"use client";

import { useState } from "react";
import InfoTip from "@/components/InfoTip";
import { apiPost, ApiError } from "@/lib/client";
import { IconX, IconUser } from "@/lib/icons";

export default function NewUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "superadmin">("admin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    name.trim() && email.trim() && password.length >= 8 && !saving;

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
      setError(err instanceof ApiError ? err.message : "Falha ao criar o usuário.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 className="panel-title-row">
              <IconUser /> Novo usuário
              <InfoTip
                title="Criar usuário"
                content="O usuário entra com o e-mail e a senha definidos aqui. Superadmin enxerga tudo de todos; admin vê apenas o próprio histórico. A senha é guardada com hash Argon2id."
              />
            </h2>
            <p className="muted" style={{ marginTop: 4 }}>
              Defina o acesso e o papel da nova conta.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            <IconX />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          {error && <div className="alert error">{error}</div>}

          <div className="field">
            <label htmlFor="nu-name">Nome</label>
            <input
              id="nu-name"
              className="input"
              placeholder="Ex.: Maria Silva"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="nu-email">E-mail</label>
            <input
              id="nu-email"
              className="input"
              type="email"
              autoComplete="off"
              placeholder="pessoa@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="nu-password">Senha</label>
            <input
              id="nu-password"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {password.length > 0 && password.length < 8 && (
              <span className="field-hint">A senha precisa de pelo menos 8 caracteres.</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="nu-role">Papel</label>
            <select
              id="nu-role"
              className="input select"
              style={{ maxWidth: "none" }}
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "superadmin")}
            >
              <option value="admin">Admin — vê apenas o próprio histórico</option>
              <option value="superadmin">Superadmin — vê tudo de todos</option>
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="button ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={!canSubmit}
              aria-busy={saving}
            >
              {saving ? <span className="button-spinner" /> : null}
              Criar usuário
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
