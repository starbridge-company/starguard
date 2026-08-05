// ============================================================
// A conta do StarGuard no VS Code.
//
// Implementa `vscode.AuthenticationProvider`, e não uma tela nossa, por um
// motivo: assim a conta aparece no **menu Contas** do editor, ao lado do
// GitHub — e sai de lá também. Quem já sabe desconectar o GitHub sabe
// desconectar o StarGuard, sem aprender nada novo.
//
// Três decisões que sustentam a segurança deste arquivo:
//
//  1. **A senha nunca passa por aqui.** O login acontece no navegador, na tela
//     do StarGuard. A extensão só vê um código que, sem o `code_verifier` que
//     ela mesma sorteou, não vale nada.
//  2. **`asExternalUri` antes de abrir.** É o que faz o retorno funcionar em
//     Remote SSH e Codespaces, onde a extensão roda numa máquina e o navegador
//     está em outra. Um servidor em localhost não seria alcançável de lá.
//  3. **Token no `SecretStorage`.** Chaveiro do sistema operacional. Nunca em
//     `settings.json` (que é versionado em muitos projetos) nem em
//     `globalState` (que é um JSON em claro no perfil).
// ============================================================
import * as vscode from "vscode";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { servidor } from "./config.js";

export const PROVIDER_ID = "starguard";
const CLIENT_ID = "starguard-vscode";
const EXTENSION_ID = "starbridge.starguard-vscode";
const CHAVE_SEGREDO = "starguard.session";

/** Quanto esperar a pessoa concluir no navegador antes de desistir. */
const TIMEOUT_MS = 5 * 60_000;

interface Guardado {
  server: string;
  refreshToken: string;
  accountId: string;
  accountLabel: string;
}

function base64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Espera o retorno do navegador em `vscode://<extensão>/auth`.
 *
 * O `UriHandler` é registrado uma vez e distribui para quem estiver esperando.
 * Registrar um por login deixaria handlers órfãos a cada tentativa cancelada.
 */
class RetornoDeAuth implements vscode.UriHandler {
  private pendentes = new Map<string, (u: vscode.Uri) => void>();

  handleUri(uri: vscode.Uri): void {
    const q = new URLSearchParams(uri.query);
    const state = q.get("state");
    if (!state) return;
    const espera = this.pendentes.get(state);
    if (espera) {
      this.pendentes.delete(state);
      espera(uri);
    }
  }

  aguardar(state: string): Promise<vscode.Uri> {
    return new Promise((resolve, reject) => {
      this.pendentes.set(state, resolve);
      setTimeout(() => {
        if (this.pendentes.delete(state)) {
          reject(new Error("Tempo esgotado esperando a autorização no navegador."));
        }
      }, TIMEOUT_MS);
    });
  }
}

export class StarGuardAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private readonly mudou = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.mudou.event;

  private readonly retorno = new RetornoDeAuth();
  private readonly assinaturas: vscode.Disposable[] = [];
  /** Access token em memória: dura 15 min e não vale a pena persistir. */
  private accessEmMemoria?: { token: string; expiraEm: number };

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.assinaturas.push(
      vscode.window.registerUriHandler(this.retorno),
      vscode.authentication.registerAuthenticationProvider(
        PROVIDER_ID,
        "StarGuard",
        this,
        { supportsMultipleAccounts: false }
      )
    );
  }

  dispose(): void {
    this.assinaturas.forEach((d) => d.dispose());
    this.mudou.dispose();
  }

  // ---- AuthenticationProvider ----

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const guardado = await this.lerGuardado();
    if (!guardado) return [];

    const access = await this.accessToken(guardado);
    if (!access) {
      // Refresh recusado: revogado, senha trocada, ou reuso detectado. Em
      // qualquer caso a credencial local não vale mais — apagá-la evita a
      // extensão insistir em algo morto a cada clique.
      await this.esquecer();
      return [];
    }

    return [
      {
        id: guardado.accountId,
        accessToken: access,
        account: { id: guardado.accountId, label: guardado.accountLabel },
        scopes: [],
      },
    ];
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    // O verificador é o segredo; só o hash dele viaja no primeiro passo.
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier, "ascii").digest());
    // O `state` amarra a RESPOSTA ao pedido — sem ele, alguém induz a conclusão
    // de um fluxo que o atacante começou e a conta dele acaba conectada aqui.
    const state = base64url(randomBytes(32));

    const base = servidor();
    // O destino tem de ser EXATAMENTE o que o servidor registrou para este
    // cliente: esquema de editor + id da extensão + /auth.
    const redirectUri = `${vscode.env.uriScheme}://${EXTENSION_ID}/auth`;

    const autorizar = vscode.Uri.parse(
      `${base}/oauth/authorize?client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`
    );

    const espera = this.retorno.aguardar(state);
    // `asExternalUri` é o que faz isto funcionar em Remote SSH e Codespaces.
    await vscode.env.openExternal(await vscode.env.asExternalUri(autorizar));

    const uri = await espera;
    const q = new URLSearchParams(uri.query);

    if (q.get("error")) throw new Error("Autorização cancelada.");

    const code = q.get("code");
    const stateVolta = q.get("state");
    // Conferido aqui, no cliente que sorteou — é o único que sabe o esperado.
    if (!code || !stateVolta || !confereState(stateVolta, state)) {
      throw new Error("A resposta não corresponde a este pedido de login.");
    }

    const tokens = await this.trocar({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });

    const conta = await this.consultarConta(base, tokens.access_token);
    const guardado: Guardado = {
      server: base,
      refreshToken: tokens.refresh_token,
      accountId: conta.id,
      accountLabel: conta.email,
    };
    await this.ctx.secrets.store(CHAVE_SEGREDO, JSON.stringify(guardado));
    this.accessEmMemoria = {
      token: tokens.access_token,
      expiraEm: Date.now() + tokens.expires_in * 1000,
    };

    const sessao: vscode.AuthenticationSession = {
      id: conta.id,
      accessToken: tokens.access_token,
      account: { id: conta.id, label: conta.email },
      scopes: [],
    };
    this.mudou.fire({ added: [sessao], removed: [], changed: [] });
    return sessao;
  }

  async removeSession(): Promise<void> {
    const guardado = await this.lerGuardado();
    await this.esquecer();
    if (guardado) {
      this.mudou.fire({
        added: [],
        removed: [
          {
            id: guardado.accountId,
            accessToken: "",
            account: { id: guardado.accountId, label: guardado.accountLabel },
            scopes: [],
          },
        ],
        changed: [],
      });
    }
    // A sessão no SERVIDOR continua até expirar ou ser revogada. Quem
    // desconectou por desconfiar de vazamento precisa saber que o passo que
    // resolve é revogar em Conta → Dispositivos conectados.
    void vscode.window.showInformationMessage(
      "StarGuard: desconectado deste editor. Para encerrar a sessão no servidor, revogue o dispositivo em Conta."
    );
  }

  // ---- Interno ----

  private async lerGuardado(): Promise<Guardado | null> {
    const bruto = await this.ctx.secrets.get(CHAVE_SEGREDO);
    if (!bruto) return null;
    try {
      const g = JSON.parse(bruto) as Guardado;
      return g.refreshToken ? g : null;
    } catch {
      return null;
    }
  }

  private async esquecer(): Promise<void> {
    this.accessEmMemoria = undefined;
    await this.ctx.secrets.delete(CHAVE_SEGREDO);
  }

  /**
   * Access token válido, renovando quando preciso.
   *
   * Cada renovação ROTACIONA o refresh, e o novo é gravado no lugar do antigo.
   * A gravação vem antes de qualquer outra coisa: se ela falhasse depois de a
   * rotação já ter acontecido no servidor, o próximo uso apresentaria um token
   * velho — que o servidor trataria como reuso e derrubaria a sessão.
   */
  private async accessToken(guardado: Guardado): Promise<string | null> {
    // Margem de 30 s: um token que expira no meio de uma chamada de análise
    // longa faria a requisição falhar por um detalhe de relógio.
    if (this.accessEmMemoria && this.accessEmMemoria.expiraEm > Date.now() + 30_000) {
      return this.accessEmMemoria.token;
    }

    const tokens = await this.trocar(
      {
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: guardado.refreshToken,
      },
      guardado.server
    ).catch(() => null);
    if (!tokens) return null;

    await this.ctx.secrets.store(
      CHAVE_SEGREDO,
      JSON.stringify({ ...guardado, refreshToken: tokens.refresh_token })
    );
    this.accessEmMemoria = {
      token: tokens.access_token,
      expiraEm: Date.now() + tokens.expires_in * 1000,
    };
    return tokens.access_token;
  }

  private async trocar(
    corpo: Record<string, string>,
    base = servidor()
  ): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const res = await fetch(`${base}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(corpo),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error_description?: string };
      throw new Error(j.error_description || `Falha na autenticação (${res.status}).`);
    }
    return (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  }

  private async consultarConta(
    base: string,
    accessToken: string
  ): Promise<{ id: string; email: string }> {
    const res = await fetch(`${base}/api/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error("Não foi possível ler a conta.");
    const j = (await res.json()) as { id?: string; sub?: string; email?: string };
    return { id: j.id ?? j.sub ?? "desconhecido", email: j.email ?? "conta" };
  }
}

/** Comparação em tempo constante — é material de segurança. */
function confereState(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sessão atual, se houver — sem forçar login.
 *
 * `createIfNone: false` de propósito: uma extensão que abre o navegador porque
 * alguém clicou num analisador seria intrusiva. Quem pede login é o comando de
 * login, ou a ação que de fato precisa da conta.
 */
export async function sessaoAtual(): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(PROVIDER_ID, [], { createIfNone: false });
}

export async function pedirLogin(): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(PROVIDER_ID, [], { createIfNone: true });
}
