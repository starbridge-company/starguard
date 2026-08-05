// ============================================================
// Endereço de repositório remoto + allowlist anti-SSRF.
//
// Mora no núcleo porque quem clona é o núcleo: o mesmo `parseGitHubRepo` é
// usado pelo clone (`git.ts`), pela validação das rotas do app (`lib/validation.ts`
// reexporta daqui), pelo `starguard scan <url>` no terminal e pela extensão do
// VS Code quando o workspace tem um remoto configurado.
//
// Módulo PURO — sem Zod, sem Node, sem rede. É o que permite a mesma allowlist
// valer nos três produtos sem cada um carregar o validador do outro.
// ============================================================

// ---- SSRF: allowlist fixa ----
// O que protege aqui é a allowlist, e só ela. Existia um `PRIVATE_HOST_RE`
// testando IP interno DEPOIS de já ter exigido `host === "github.com"`: nunca
// podia ser verdadeiro. Era código morto que dava falsa sensação de proteção —
// e nem contra rebind de DNS servia, porque testava a string do host, não o IP
// resolvido. Ver AUDITORIA.md#BUG-18.
//
// Se um dia a allowlist deixar de ser fixa (repositório auto-hospedado, GitHub
// Enterprise), a checagem de destino interno precisa voltar — e no IP
// resolvido, não no nome.
const ALLOWED_HOSTS = new Set(["github.com", "www.github.com"]);

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  url: string;
}

export function parseGitHubRepo(input: string): GitHubRepoRef | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo)) {
    return null;
  }
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/**
 * O alvo informado é um endereço remoto ou um caminho no disco?
 *
 * O terminal e a extensão aceitam os dois (`starguard scan .` e
 * `starguard scan https://github.com/org/repo`), e a diferença decide qual
 * workspace abrir — clonado ou local. O painel web só aceita remoto, porque
 * não tem acesso ao disco de quem está do outro lado da tela.
 */
export function looksLikeUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target.trim());
}
