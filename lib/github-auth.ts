// ============================================================
// Quem é o dono do token que vai ao GitHub. Ver AUDITORIA.md#SEC-06.
//
// O `GITHUB_TOKEN` do servidor existe para a instância de dono único (o caso
// do MVP rodando na máquina de uma pessoa). Num deploy com várias contas ele
// vira um furo de controle de acesso: quem não tem token usaria o do servidor
// e leria — ou abriria PR em — qualquer repositório privado ao qual o token do
// servidor tenha acesso, bastando saber a URL. Por isso o fallback global
// passou a exigir `SINGLE_TENANT=true` explícito.
//
// Isomórfico e sem `server-only` de propósito: é lógica pura, e a regra de
// segurança precisa ter teste de unidade cobrindo o caminho negativo.
// ============================================================

/**
 * Lido a cada chamada, não uma vez na carga do módulo: a decisão é de
 * segurança e precisa refletir o ambiente do processo no momento do uso
 * (inclusive nos testes, que alternam os dois modos).
 */
export function isSingleTenant(): boolean {
  return process.env.SINGLE_TENANT === "true";
}

/** Erro de token ausente — mensagem acionável, não um 404 genérico. */
export class GitHubTokenRequired extends Error {
  constructor(
    message = "Informe um token do GitHub para acessar este repositório."
  ) {
    super(message);
    this.name = "GitHubTokenRequired";
  }
}

/**
 * Token efetivo para uma operação de LEITURA (metadados, conteúdo de arquivo,
 * clone). Sem token o Octokit ainda funciona em repositório público — por isso
 * aqui devolvemos `undefined` em vez de lançar.
 */
export function resolveGitHubToken(userToken?: string | null): string | undefined {
  const own = userToken?.trim();
  if (own) return own;
  if (!isSingleTenant()) return undefined;
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

/**
 * Token efetivo para uma operação de ESCRITA (abrir PR). Aqui não há caminho
 * anônimo: ou o usuário tem token, ou a instância é de dono único.
 */
export function requireGitHubToken(userToken?: string | null): string {
  const token = resolveGitHubToken(userToken);
  if (!token) {
    throw new GitHubTokenRequired(
      "Informe um token do GitHub com permissão de escrita para abrir o pull request."
    );
  }
  return token;
}
