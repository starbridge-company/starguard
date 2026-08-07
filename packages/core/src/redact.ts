// ============================================================
// Redação de segredos em texto livre. Mensagens de erro de ferramentas
// externas (git, scanners, provedores de IA) são propagadas para a UI e
// PERSISTIDAS no JSONB `phases` — qualquer credencial que passe por aqui vira
// vazamento permanente. Ver AUDITORIA.md#SEC-01.
//
// Isomórfico de propósito: usado no servidor (jobs, github) e seguro no
// cliente, caso um dia a mensagem seja formatada lá.
// ============================================================

const PATTERNS: { re: RegExp; to: string }[] = [
  // Credenciais embutidas em URL: https://user:senha@host, https://token@host.
  // É o caso do `git clone` — a mensagem "fatal: Authentication failed for
  // 'https://x-access-token:ghp_...@github.com/o/r.git'" traz o PAT inteiro.
  //
  // ---- Por que QUALQUER esquema, e não só http(s) ----
  //
  // A regra cobria `https?://` e deixava passar `postgres://sg:senha@host`,
  // `redis://:senha@host`, `mongodb://…` — exatamente as URLs que aparecem em
  // erro de CONEXÃO, que é o erro mais comum de todos num deploy novo. A senha
  // do banco ia para o stdout em texto claro.
  //
  // Ficou mais urgente quando o logger passou a seguir a corrente de `cause`
  // (ver `logger.ts`): o motivo real do Drizzle é justamente o erro do `pg`, e
  // é ele que carrega a string de conexão. A correção de diagnóstico teria
  // ampliado o vazamento se esta linha continuasse só com `https?`.
  // Tudo entre `://` e o primeiro `@` some. Sem exigir usuário: `redis://:senha@host`
  // tem o usuário VAZIO, e a versão anterior — que pedia ao menos um caractere
  // antes dos dois-pontos — deixava justamente esse passar.
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, to: "$1***@" },
  // Tokens do GitHub (clássico, fine-grained, OAuth, app, refresh).
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, to: "gh*_***" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, to: "github_pat_***" },
  // Chaves de IA.
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, to: "sk-ant-***" },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, to: "sk-***" },
  { re: /\bAIza[A-Za-z0-9_-]{30,}\b/g, to: "AIza***" },
  // Esquemas de autorização soltos no texto — ANTES do header, senão o header
  // consome só a palavra "Bearer" e deixa o token à mostra.
  { re: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, to: "$1 ***" },
  // Cabeçalhos de autorização: consome o valor inteiro até o fim da linha ou
  // um delimitador. Redigir demais aqui é preferível a redigir de menos.
  { re: /\b(authorization|x-api-key|api[-_]?key)\s*[:=]\s*[^\n,;"']+/gi, to: "$1: ***" },
];

/** Substitui credenciais conhecidas por marcadores. Nunca lança. */
export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { re, to } of PATTERNS) out = out.replace(re, to);
  return out;
}

/** Extrai a mensagem de um erro desconhecido, já redigida. */
export function redactError(e: unknown): string {
  const raw =
    e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  return redact(raw);
}
