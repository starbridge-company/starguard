// ============================================================
// Os clientes públicos do StarGuard.
//
// "Público" no sentido do OAuth: cliente que NÃO consegue guardar segredo. O
// `.vsix` é um zip que qualquer pessoa abre, e o pacote do CLI é código que
// qualquer pessoa lê. Embutir um `client_secret` neles seria publicá-lo — por
// isso não existe segredo aqui, e por isso o PKCE é obrigatório: é ele que faz
// o papel que o segredo faria.
//
// A lista vive em CÓDIGO e não em tabela porque são dois clientes, nossos, que
// mudam junto com o produto. Uma tabela de clientes só faria sentido se
// terceiros fossem se registrar — e aí viriam junto as telas de administração,
// a rotação de segredo e a revisão de escopo, que é outro produto.
//
// Módulo PURO: sem banco, sem rede. É o que permite testar a regra de
// `redirect_uri` — a parte que mais importa — sem subir nada.
// ============================================================

export interface OAuthClient {
  id: string;
  /** Nome exibido na tela de consentimento. Vira chave de tradução. */
  nameKey: string;
  /** O que este cliente pode fazer, em chaves — a pessoa lê antes de aprovar. */
  scopeKeys: string[];
}

export const OAUTH_CLIENTS: Record<string, OAuthClient> = {
  "starguard-vscode": {
    id: "starguard-vscode",
    nameKey: "oauth.client.vscode",
    scopeKeys: ["oauth.scope.analyze", "oauth.scope.fix", "oauth.scope.profile"],
  },
  "starguard-cli": {
    id: "starguard-cli",
    nameKey: "oauth.client.cli",
    scopeKeys: ["oauth.scope.analyze", "oauth.scope.fix", "oauth.scope.profile"],
  },
};

export function getClient(id: string | null | undefined): OAuthClient | undefined {
  return id ? OAUTH_CLIENTS[id] : undefined;
}

/**
 * Esquemas de URI aceitos para a extensão.
 *
 * O VS Code não tem um esquema só: o Insiders usa `vscode-insiders://`, e os
 * editores derivados (Cursor, Windsurf, VSCodium) usam o seu. Recusar todos
 * menos `vscode://` faria o login simplesmente não voltar para quem usa
 * qualquer um deles — e sem mensagem, porque o erro aconteceria no navegador.
 *
 * O que NÃO é afrouxado é o resto: o caminho depois do esquema tem de ser
 * exatamente o id da extensão publicada. Um esquema conhecido apontando para
 * outra extensão é justamente o ataque que se quer barrar.
 */
const ESQUEMAS_EDITOR = new Set([
  "vscode",
  "vscode-insiders",
  "vscodium",
  "cursor",
  "windsurf",
]);

/** Id da extensão publicada — `publisher.nome` do `package.json`. */
const EXTENSION_ID = "starbridge.starguard-vscode";

/**
 * O `redirect_uri` apresentado é aceitável para este cliente?
 *
 * Esta função é a fronteira do fluxo inteiro. Se ela deixar passar um destino
 * que não é do cliente, o código de autorização vai parar na mão de quem
 * controla aquele destino — e o PKCE não salva, porque quem escolheu o destino
 * também escolheu o `code_verifier`.
 *
 * Por isso a comparação é por ESTRUTURA (esquema, host, caminho), nunca por
 * `startsWith`: `https://starguard.app.exemplo-malicioso.com` começa com
 * `https://starguard.app`.
 */
export function redirectUriPermitido(clientId: string, redirectUri: string): boolean {
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return false;
  }

  // Fragmento nunca chega ao servidor e query extra abre espaço para
  // ambiguidade na comparação: exigimos a forma limpa.
  if (u.hash || u.search) return false;

  if (clientId === "starguard-vscode") {
    const esquema = u.protocol.replace(/:$/, "").toLowerCase();
    if (!ESQUEMAS_EDITOR.has(esquema)) return false;
    // `vscode://starguard.starguard-vscode/auth`
    // O host da URI é o id da extensão; o caminho, a rota do UriHandler.
    return u.hostname.toLowerCase() === EXTENSION_ID.toLowerCase() && u.pathname === "/auth";
  }

  if (clientId === "starguard-cli") {
    // RFC 8252 §7.3: aplicação nativa usa loopback com porta EFÊMERA — o
    // sistema é quem escolhe a porta na hora, então fixá-la aqui quebraria o
    // login sempre que a porta estivesse ocupada. O que se fixa é o resto:
    // só HTTP em loopback literal, e só neste caminho.
    //
    // `localhost` NÃO entra de propósito: ele resolve por DNS, e num host
    // envenenado apontaria para outra máquina. `127.0.0.1` e `[::1]` são
    // literais e não passam por resolução.
    if (u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "[::1]" && host !== "::1") return false;
    return u.pathname === "/callback";
  }

  return false;
}
