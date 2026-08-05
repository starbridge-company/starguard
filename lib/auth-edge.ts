// ============================================================
// Quem está pedindo, decidido no EDGE — AUDITORIA.md#SEC-15.
//
// Este arquivo nasceu de um bug que custou caro e que era invisível por
// construção. O `requireSession` de `lib/http.ts` ganhou suporte a
// `Authorization: Bearer` para atender a extensão e o CLI, e isso foi coberto
// por teste. Só que **nada daquilo era alcançado**: o middleware roda antes de
// qualquer rota, é default-deny, e lia SOMENTE o cookie. Toda requisição da
// extensão levava 401 na borda.
//
// O sintoma não apontava para cá. O login funcionava até o fim — código
// trocado por token, tudo certo — e morria ao ler a conta, o que parecia
// problema do `/api/me`. A resposta 401 até tinha a cara de "requisição sem
// credencial", que é exatamente o que se espera ver. Só o log passo a passo
// mostrou onde parava.
//
// A lição que virou este módulo: **testar a camada errada é pior que não
// testar**, porque a suíte verde diz que está coberto. A decisão de acesso
// agora é uma função pura, exercitada por teste, e o middleware apenas a
// aplica.
//
// Precisa ser EDGE-SAFE: nada de banco, `node:*` ou `server-only`. A
// verificação profunda (família da sessão revogada, conta apagada) continua
// nas rotas — é defesa em profundidade, e o edge não alcança o banco.
// ============================================================

/** De onde veio a credencial. Medido do pedido, nunca escolhido pelo cliente. */
export type Origem = "bearer" | "cookie";

export interface Credencial {
  origem: Origem;
  token: string;
}

const BEARER_RE = /^Bearer\s+(.+)$/i;

/**
 * A credencial do pedido, com o header tendo precedência sobre o cookie.
 *
 * **Não há queda para o cookie quando o Bearer falha**, e isso é a mesma
 * regra do `requireSession`: `requireCsrf` dispensa a checagem quando existe
 * `Authorization`, então autenticar por cookie depois de um Bearer inválido
 * seria autenticar SEM CSRF — bastaria acrescentar um header qualquer para
 * pular a proteção. Quem escolhe é a origem da credencial, e ela é medida.
 */
export function credencialDoPedido(
  authorization: string | null | undefined,
  cookie: string | null | undefined
): Credencial | null {
  const m = authorization?.match(BEARER_RE);
  const bearer = m?.[1]?.trim();
  if (bearer) return { origem: "bearer", token: bearer };
  const c = cookie?.trim();
  return c ? { origem: "cookie", token: c } : null;
}

/** O mínimo que o edge consegue conferir sobre as claims. */
export interface ClaimsMinimas {
  type?: string;
  role?: string;
  sub?: string;
}

export type Veredito =
  | { acao: "permitir"; sub?: string }
  | { acao: "recusar"; motivo: "sem_credencial" | "proibido" };

/**
 * Deixa passar, ou não.
 *
 * Duas regras, e a segunda não é óbvia:
 *
 *  1. Precisa ser um token de ACESSO com papel. Refresh apresentado como
 *     acesso é recusado — são credenciais de propósitos diferentes.
 *  2. **Credencial de cliente nunca entra na área de governança.** O que a
 *     extensão e o CLI pediram autorização para fazer é analisar código,
 *     propor correção e ler o perfil; administrar a plataforma não está entre
 *     os escopos consentidos. Vale mesmo quando quem está no editor É
 *     superadmin: o papel diz o que a PESSOA pode, o público do token diz o
 *     que AQUELE cliente foi autorizado a fazer em nome dela. Confundir os
 *     dois transformaria um token de editor vazado em acesso administrativo.
 */
export function decidirAcesso(entrada: {
  origem: Origem | null;
  claims: ClaimsMinimas | null;
  areaAdmin: boolean;
  papelDeAdmin: string;
}): Veredito {
  const { origem, claims, areaAdmin, papelDeAdmin } = entrada;

  const autenticado = !!claims && claims.type === "access" && !!claims.role;
  if (!autenticado || !origem) return { acao: "recusar", motivo: "sem_credencial" };

  if (areaAdmin) {
    if (origem === "bearer") return { acao: "recusar", motivo: "proibido" };
    if (claims!.role !== papelDeAdmin) return { acao: "recusar", motivo: "proibido" };
  }

  return { acao: "permitir", sub: claims!.sub };
}
