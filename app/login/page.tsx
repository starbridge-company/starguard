"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/client";
import { initTheme } from "@/lib/theme";
import { IconShield } from "@/lib/icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@starguard.local");
  const [password, setPassword] = useState("StarGuard!2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initTheme();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost("/api/auth/login", { email, password });
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      router.push(next && next.startsWith("/") ? next : "/");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Não foi possível entrar."
      );
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <div className="logo-badge">
            <IconShield />
          </div>
        </div>

        <div className="auth-title">
          <h1>
            Star<span className="brand-word">Guard</span>
          </h1>
          <p>Copilot de Segurança · DevSecOps assistido por IA</p>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="auth-form">
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="button primary large block"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <span className="button-spinner" /> : null}
            Entrar
          </button>
        </div>

        <p className="auth-hint">
          Ambiente de governança (MVP). Credenciais demo já preenchidas:
          <br />
          <code>admin@starguard.local</code> · <code>StarGuard!2026</code>
        </p>
      </form>
    </div>
  );
}
