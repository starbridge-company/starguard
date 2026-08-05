// ============================================================
// Emissão do par de tokens de CLIENTE (extensão, CLI).
//
// Separado das rotas por um motivo prático: as duas concessões
// (`authorization_code` e `refresh_token`) terminam no mesmo lugar — emitir um
// access curto e um refresh rotacionado — e duplicar isso em duas rotas é como
// se perde a simetria entre elas.
//
// A checagem do CORTE DE SESSÃO (`sessionsInvalidatedAt`) mora aqui de
// propósito: trocar a senha tem de derrubar a extensão e o CLI, não só o
// navegador. Se essa regra ficasse só na rota de refresh do cookie, quem
// trocasse a senha continuaria com o editor conectado por trinta dias.
// NODE-ONLY.
// ============================================================
import "server-only";
import { signAccessToken, signRefreshToken } from "@/lib/jwt";
import * as usersRepo from "@/lib/repos/users";

/** Vida do refresh de cliente. Mais longo que o do navegador porque o editor
 *  não é reaberto todo dia — e é a rotação, não o TTL, que limita o estrago. */
export const CLIENT_REFRESH_TTL = process.env.OAUTH_REFRESH_TTL || "30d";

export interface ClientTokens {
  accessToken: string;
  refreshToken: string;
  /** Segundos até o access expirar — o cliente agenda a renovação por isto. */
  expiresIn: number;
  tokenType: "Bearer";
}

export type IssueResult =
  | { ok: true; tokens: ClientTokens }
  | { ok: false; reason: "user_gone" | "session_cut" };

/**
 * Emite o par para uma sessão de cliente já existente.
 *
 * O usuário é lido do BANCO, nunca das claims: conta excluída não pode
 * continuar renovando, e papel rebaixado não pode sobreviver dentro de um
 * token antigo. É a mesma correção do AUDITORIA.md#SEC-02, aplicada ao
 * caminho novo.
 */
export async function issueClientTokens(opts: {
  userId: string;
  clientId: string;
  familyId: string;
  jti: string;
  /** `iat` do refresh apresentado, para comparar com o corte de sessão. */
  issuedAt?: number;
}): Promise<IssueResult> {
  const fresh = await usersRepo.findById(opts.userId); // já filtra deletedAt
  if (!fresh) return { ok: false, reason: "user_gone" };

  if (opts.issuedAt && fresh.sessionsInvalidatedAt) {
    // `iat` do JWT tem precisão de SEGUNDOS: comparamos em segundos para que a
    // sessão emitida no mesmo segundo do corte não se auto-invalide.
    const corte = Math.floor(fresh.sessionsInvalidatedAt.getTime() / 1000);
    if (opts.issuedAt < corte) return { ok: false, reason: "session_cut" };
  }

  const base = {
    sub: fresh.id,
    email: fresh.email,
    role: fresh.role, // papel ATUAL, não o que estava no token
    fam: opts.familyId,
    cid: opts.clientId,
  };

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(base, "client"),
    signRefreshToken(base, opts.jti, "client", CLIENT_REFRESH_TTL),
  ]);

  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: ttlEmSegundos(),
      tokenType: "Bearer",
    },
  };
}

/** `JWT.accessTtl` é string ("15m"); o cliente precisa do número. */
function ttlEmSegundos(): number {
  const raw = process.env.JWT_ACCESS_TTL || "15m";
  const m = raw.match(/^(\d+)([smhd])$/);
  if (!m) return 900;
  const n = Number(m[1]);
  const unidade = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]!]!;
  return n * unidade;
}
