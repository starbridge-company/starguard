"use client";

// ============================================================
// Tela de consentimento — o único ponto do fluxo que uma pessoa vê.
//
// O que ela precisa fazer, em ordem de importância:
//
//  1. Dizer QUEM está pedindo e O QUE vai poder fazer. Um botão "Autorizar"
//     sem essa informação não é consentimento, é um obstáculo.
//  2. Recusar pedido malformado ANTES de desenhar o botão. Se o `client_id`
//     não é conhecido ou o `redirect_uri` não bate, a tela não oferece nada —
//     porque o pedido não veio de onde diz que veio.
//  3. Avisar que autorizar só faz sentido se foi a própria pessoa que começou.
//     É a defesa que nenhum código dá: alguém pode ter mandado o link.
//
// O código de autorização volta pelo `redirect_uri` que o cliente registrou —
// nunca por um que veio na URL sem checagem. Quem valida é o servidor
// (`redirectUriPermitido`), duas vezes: aqui e na troca por token.
// ============================================================
import { useEffect, useState } from "react";
import { apiPost } from "@/lib/client";
import { useApiError, useT, type MessageKey } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { initTheme } from "@/lib/theme";
import { IconShield, IconCheck } from "@/lib/icons";

interface Pedido {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state?: string;
}

/** Nome e escopos do cliente — em chave, para a tela seguir o idioma. */
const CLIENTES: Record<string, { nameKey: MessageKey; scopeKeys: MessageKey[] }> = {
  "starguard-vscode": {
    nameKey: "oauth.client.vscode",
    scopeKeys: ["oauth.scope.analyze", "oauth.scope.fix", "oauth.scope.profile"],
  },
  "starguard-cli": {
    nameKey: "oauth.client.cli",
    scopeKeys: ["oauth.scope.analyze", "oauth.scope.fix", "oauth.scope.profile"],
  },
};

export default function AuthorizePage() {
  const t = useT();
  const apiError = useApiError();
  const { me, loading: carregandoConta } = useMe();

  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [invalido, setInvalido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    initTheme();
    const q = new URLSearchParams(window.location.search);
    const p: Pedido = {
      clientId: q.get("client_id") ?? "",
      redirectUri: q.get("redirect_uri") ?? "",
      codeChallenge: q.get("code_challenge") ?? "",
      codeChallengeMethod: q.get("code_challenge_method") ?? "",
      state: q.get("state") ?? undefined,
    };
    // A recusa acontece ANTES de desenhar o botão. Um pedido que não bate com
    // nenhum cliente conhecido não deve nem oferecer a opção de autorizar.
    const ok =
      !!CLIENTES[p.clientId] &&
      !!p.redirectUri &&
      p.codeChallengeMethod === "S256" &&
      /^[A-Za-z0-9\-_]{43}$/.test(p.codeChallenge);
    if (!ok) setInvalido(true);
    else setPedido(p);
  }, []);

  // Sem sessão, o login vem primeiro — e volta para cá com a query intacta.
  useEffect(() => {
    if (!carregandoConta && !me && !invalido) {
      const destino = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?next=${destino}`);
    }
  }, [carregandoConta, me, invalido]);

  const autorizar = async () => {
    if (!pedido) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await apiPost<{ code: string; state?: string }>(
        "/api/oauth/authorize",
        pedido
      );
      // A volta é montada com o `redirect_uri` que o SERVIDOR validou, e o
      // `state` volta como veio — quem o confere é o cliente, que foi quem o
      // sorteou.
      const url = new URL(pedido.redirectUri);
      url.searchParams.set("code", r.code);
      if (r.state) url.searchParams.set("state", r.state);
      setPronto(true);
      window.location.href = url.toString();
    } catch (e) {
      setErro(apiError(e, "oauth.failed"));
      setEnviando(false);
    }
  };

  const cancelar = () => {
    if (!pedido) return;
    // Cancelar também volta para o cliente, com `error=access_denied` (RFC 6749
    // §4.1.2.1). Fechar a aba deixaria o editor esperando para sempre.
    const url = new URL(pedido.redirectUri);
    url.searchParams.set("error", "access_denied");
    if (pedido.state) url.searchParams.set("state", pedido.state);
    window.location.href = url.toString();
  };

  if (invalido) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="alert error">{t("oauth.invalidRequest")}</div>
        </div>
      </div>
    );
  }

  if (carregandoConta || !pedido || !me) {
    return (
      <div className="auth">
        <div className="auth-card" style={{ placeItems: "center" }}>
          <span className="button-spinner" />
        </div>
      </div>
    );
  }

  const cliente = CLIENTES[pedido.clientId]!;
  const nomeCliente = t(cliente.nameKey);

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-badge">
            <IconShield />
          </div>
        </div>

        <div className="auth-title">
          <h1>{t("oauth.title", { client: nomeCliente })}</h1>
          <p>{t("oauth.subtitle", { email: me.email })}</p>
        </div>

        <ul className="oauth-scopes">
          {cliente.scopeKeys.map((k) => (
            <li key={k}>
              <IconCheck />
              <span>{t(k)}</span>
            </li>
          ))}
        </ul>

        {/* A defesa que nenhum código dá: o link pode ter sido mandado por
            outra pessoa. Quem lê precisa saber que a pergunta certa é "fui eu
            que comecei isto?". */}
        <div className="alert info">{t("oauth.warning")}</div>

        {erro && <div className="alert error">{erro}</div>}
        {pronto && (
          <div className="alert success">{t("oauth.done", { client: nomeCliente })}</div>
        )}

        <div className="oauth-actions">
          <button type="button" className="button ghost" onClick={cancelar} disabled={enviando}>
            {t("oauth.deny")}
          </button>
          <button
            type="button"
            className="button primary"
            onClick={autorizar}
            disabled={enviando || pronto}
            aria-busy={enviando}
          >
            {enviando ? <span className="button-spinner" /> : null}
            {t("oauth.approve")}
          </button>
        </div>
      </div>
    </div>
  );
}
