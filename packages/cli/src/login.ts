// ============================================================
// `starguard login` — OAuth 2.0 Authorization Code + PKCE por loopback.
//
// O caminho é o da RFC 8252 (OAuth para aplicação nativa): sobe um servidor
// HTTP em `127.0.0.1` numa porta EFÊMERA, abre o navegador, e o código de
// autorização volta por ali. A senha é digitada no navegador, na tela do
// StarGuard — nunca aqui.
//
// Por que não pedir e-mail e senha direto no terminal, que seria mais simples:
// porque isso obrigaria o CLI a manipular a senha, e um dia a guardá-la ou a
// mandá-la para o lugar errado. Com este fluxo, o terminal nunca vê a senha —
// só recebe um código que, sem o `code_verifier` que ele mesmo sorteou, não
// vale nada.
//
// Sem dependência nova: `node:http`, `node:crypto` e o navegador do sistema.
// NODE-ONLY.
// ============================================================
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { AddressInfo } from "node:net";
import { loadCredentials, saveCredentials, serverUrl } from "./credentials.js";

const CLIENT_ID = "starguard-cli";
const CALLBACK_PATH = "/callback";

/** Quanto tempo esperar a pessoa concluir no navegador antes de desistir. */
const TIMEOUT_MS = 5 * 60_000;

function base64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Abre a URL no navegador do sistema. Falhar aqui não é fatal: imprimimos. */
function abrirNavegador(url: string): void {
  const cmd =
    process.platform === "win32"
      ? { bin: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { bin: "open", args: [url] }
        : { bin: "xdg-open", args: [url] };
  try {
    spawn(cmd.bin, cmd.args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* sem navegador (SSH, container): a URL impressa resolve */
  }
}

/** Página que o navegador mostra ao voltar. Sem CSS externo, sem rede. */
function paginaFinal(titulo: string, detalhe: string): string {
  // Escapa todos os caracteres HTML-sensíveis, incluindo aspas simples, para
  // que qualquer valor interpolado não possa injetar marcação/atributos.
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>StarGuard</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f1512;color:#e8efea">
<div style="text-align:center;max-width:420px;padding:24px">
<h1 style="font-size:1.25rem;margin:0 0 8px">${esc(titulo)}</h1>
<p style="opacity:.7;margin:0">${esc(detalhe)}</p>
</div></body></html>`;
}

export interface LoginResult {
  refreshToken: string;
  accessToken: string;
}

/** Comparação do `state` em tempo constante — é material de segurança. */
function stateConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function login(opts: { imprimir: (s: string) => void }): Promise<LoginResult> {
  const servidor = serverUrl();

  // O verificador é o segredo; só o hash dele viaja no primeiro passo.
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier, "ascii").digest());
  // O `state` amarra a RESPOSTA ao pedido: sem ele, alguém induz a pessoa a
  // concluir um fluxo que o atacante começou, e a conta dele acaba conectada
  // a este terminal.
  const state = base64url(randomBytes(32));

  const { code, redirectUri, fechar } = await esperarCodigo({
    state,
    servidor,
    challenge,
    imprimir: opts.imprimir,
  });

  try {
    const res = await fetch(`${servidor}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { error_description?: string };
      throw new Error(corpo.error_description || `Falha ao obter o token (${res.status}).`);
    }

    const t = (await res.json()) as { access_token: string; refresh_token: string };
    await saveCredentials({
      server: servidor,
      refreshToken: t.refresh_token,
      savedAt: new Date().toISOString(),
    });
    return { refreshToken: t.refresh_token, accessToken: t.access_token };
  } finally {
    fechar();
  }
}

/**
 * Sobe o servidor de retorno e espera o código.
 *
 * Porta `0` = o sistema escolhe uma livre. Fixar uma porta quebraria o login
 * sempre que ela estivesse ocupada — e é por isso que a allowlist do servidor
 * aceita qualquer porta em `127.0.0.1` (RFC 8252 §7.3).
 */
function esperarCodigo(opts: {
  state: string;
  servidor: string;
  challenge: string;
  imprimir: (s: string) => void;
}): Promise<{ code: string; redirectUri: string; fechar: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }

      const responder = (titulo: string, detalhe: string, status = 200) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(paginaFinal(titulo, detalhe));
      };

      const erro = url.searchParams.get("error");
      if (erro) {
        responder("Autorização cancelada", "Nada foi conectado. Pode fechar esta aba.");
        reject(new Error("Autorização cancelada."));
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      // O `state` é conferido AQUI, no cliente que o sorteou — é o único lugar
      // que sabe qual era o esperado. Divergiu: a resposta não pertence a este
      // pedido, e aceitar o código seria completar o fluxo de outra pessoa.
      if (!code || !state || !stateConfere(state, opts.state)) {
        responder("Pedido inválido", "A resposta não corresponde a este login.", 400);
        reject(new Error("state divergente — a resposta não corresponde ao pedido."));
        return;
      }

      responder("Pronto!", "Pode fechar esta aba e voltar ao terminal.");
      resolve({ code, redirectUri, fechar: () => server.close() });
    });

    let redirectUri = "";

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

      const autorizar = new URL("/oauth/authorize", opts.servidor);
      autorizar.searchParams.set("client_id", CLIENT_ID);
      autorizar.searchParams.set("redirect_uri", redirectUri);
      autorizar.searchParams.set("code_challenge", opts.challenge);
      autorizar.searchParams.set("code_challenge_method", "S256");
      autorizar.searchParams.set("state", opts.state);

      opts.imprimir(autorizar.toString());
      abrirNavegador(autorizar.toString());
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Tempo esgotado esperando a autorização no navegador."));
    }, TIMEOUT_MS).unref();
  });
}

/**
 * Troca o refresh guardado por um access novo.
 *
 * Cada uso ROTACIONA o refresh, e o novo é gravado no lugar do antigo. Se a
 * gravação falhar depois de a rotação já ter acontecido no servidor, a próxima
 * execução apresentará um token velho — que o servidor tratará como reuso e
 * derrubará a sessão. É o custo de detectar roubo, e por isso a gravação vem
 * antes de qualquer outra coisa.
 */
export async function accessTokenAtual(): Promise<string | null> {
  const cred = await loadCredentials();
  if (!cred) return null;

  const res = await fetch(`${cred.server}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: cred.refreshToken,
    }),
  }).catch(() => null);

  if (!res?.ok) return null;

  const t = (await res.json()) as { access_token: string; refresh_token: string };
  await saveCredentials({ ...cred, refreshToken: t.refresh_token, savedAt: new Date().toISOString() });
  return t.access_token;
}
