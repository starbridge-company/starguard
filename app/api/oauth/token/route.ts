// ============================================================
// POST /api/oauth/token — troca de código por token, e renovação.
//
// Rota PÚBLICA por definição (o cliente ainda não tem credencial quando chega
// aqui), e por isso a mais exposta do fluxo. Três defesas, nesta ordem:
//
//  1. rate limit por cliente + IP, antes de qualquer trabalho;
//  2. o código só vira token se o `code_verifier` casar com o desafio (PKCE);
//  3. o refresh só renova se for o CORRENTE da família — senão é reuso, e a
//     família inteira cai.
//
// Segue o formato de erro do OAuth 2.0 (RFC 6749 §5.2) e não o `jsonError` do
// app: as bibliotecas de cliente esperam `{"error":"invalid_grant"}`, e um
// formato nosso obrigaria cada cliente a tratar o StarGuard como caso especial.
// ============================================================
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { audit, hashIp } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { parseRate } from "@/lib/config";
import { getClient, redirectUriPermitido } from "@/lib/oauth/clients";
import { verifyChallenge } from "@/lib/oauth/pkce";
import { redeemCode } from "@/lib/oauth/codes";
import { rotate, startSession } from "@/lib/oauth/sessions";
import { issueClientTokens } from "@/lib/oauth/tokens";

export const runtime = "nodejs";

/**
 * Cota da rota. Mais apertada que a da API em geral porque aqui cada tentativa
 * é um palpite contra credencial: um código tem 60 s de vida, e força bruta
 * dentro dessa janela é o ataque óbvio.
 */
const TOKEN_RATE = parseRate(process.env.OAUTH_TOKEN_RATE_LIMIT || "20/1m", {
  max: 20,
  windowMs: 60_000,
});

type OAuthErro =
  | "invalid_request"
  | "invalid_grant"
  | "invalid_client"
  | "unsupported_grant_type"
  | "slow_down";

function erro(code: OAuthErro, description: string, status = 400): NextResponse {
  const res = NextResponse.json({ error: code, error_description: description }, { status });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}

function ok(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): NextResponse {
  const res = NextResponse.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
  });
  // Token em cache de proxy é vazamento. A RFC 6749 §5.1 exige os dois.
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}

/** Aceita `application/x-www-form-urlencoded` (o do OAuth) e JSON. */
async function lerCorpo(req: NextRequest): Promise<Record<string, string>> {
  const tipo = req.headers.get("content-type") || "";
  if (tipo.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(j).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])
    );
  }
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

export async function POST(req: NextRequest) {
  const body = await lerCorpo(req);
  const clientId = body.client_id;
  const ip = clientIp(req.headers);

  const client = getClient(clientId);
  if (!client) return erro("invalid_client", "client_id desconhecido.", 401);

  const cota = await rateLimit(`oauth:token:${clientId}:${ip}`, TOKEN_RATE);
  if (!cota.allowed) {
    const res = erro("slow_down", "Muitas tentativas. Aguarde alguns instantes.", 429);
    res.headers.set("Retry-After", String(Math.ceil(cota.resetMs / 1000)));
    return res;
  }

  if (body.grant_type === "authorization_code") {
    return trocarCodigo(req, body, clientId, ip);
  }
  if (body.grant_type === "refresh_token") {
    return renovar(req, body, clientId, ip);
  }
  return erro("unsupported_grant_type", "grant_type não suportado.");
}

// ------------------------------------------------------------
// authorization_code
// ------------------------------------------------------------

async function trocarCodigo(
  req: NextRequest,
  body: Record<string, string>,
  clientId: string,
  ip: string
): Promise<NextResponse> {
  const { code, code_verifier: verifier, redirect_uri: redirectUri } = body;
  if (!code || !verifier || !redirectUri) {
    return erro("invalid_request", "code, code_verifier e redirect_uri são obrigatórios.");
  }
  // Reconferido na troca, e não só na autorização: quem apresenta o código tem
  // de apontar para o mesmo destino com que ele foi emitido.
  if (!redirectUriPermitido(clientId, redirectUri)) {
    return erro("invalid_grant", "redirect_uri não permitido para este cliente.");
  }

  const resgate = await redeemCode({
    code,
    clientId,
    redirectUri,
    challengeOk: (challenge) => verifyChallenge(verifier, challenge),
  });

  if (!resgate.ok) {
    // Um código apresentado DUAS vezes é sinal de interceptação — alguém
    // correu contra o cliente legítimo. Vai para a trilha nomeado, não
    // dissolvido num "invalid_grant" genérico.
    if (resgate.reason === "already_used") {
      audit("oauth.code_reuse", { clientId }, undefined, hashIp(ip));
    }
    // A resposta ao cliente é a MESMA nos quatro motivos: distinguir
    // "expirado" de "não existe" de "não casou" entregaria a quem está
    // tentando adivinhar exatamente a informação que falta para acertar.
    return erro("invalid_grant", "Código inválido, expirado ou já utilizado.");
  }

  const sessao = await startSession({
    userId: resgate.userId,
    clientId,
    label: rotulo(req),
  });

  const emissao = await issueClientTokens({
    userId: resgate.userId,
    clientId,
    familyId: sessao.familyId,
    jti: sessao.jti,
  });
  if (!emissao.ok) return erro("invalid_grant", "Conta indisponível.");

  audit(
    "oauth.token",
    { clientId, sessionId: sessao.sessionId },
    resgate.userId,
    hashIp(ip)
  );
  return ok(emissao.tokens);
}

// ------------------------------------------------------------
// refresh_token
// ------------------------------------------------------------

async function renovar(
  req: NextRequest,
  body: Record<string, string>,
  clientId: string,
  ip: string
): Promise<NextResponse> {
  const token = body.refresh_token;
  if (!token) return erro("invalid_request", "refresh_token é obrigatório.");

  const claims = await verifyToken(token, "client");
  if (!claims || claims.type !== "refresh" || !claims.jti || !claims.fam) {
    return erro("invalid_grant", "Refresh token inválido.");
  }
  // O token foi emitido para OUTRO cliente. Sem esta checagem, um refresh
  // obtido pelo CLI valeria na extensão e vice-versa.
  if (claims.cid !== clientId) {
    return erro("invalid_grant", "Refresh token não pertence a este cliente.");
  }

  const giro = await rotate({ familyId: claims.fam, jti: claims.jti });

  if (!giro.ok) {
    if (giro.reason === "reuse_detected") {
      // O evento mais importante desta rota inteira: assinatura válida, família
      // conhecida, token que já não é o corrente. A família já foi derrubada
      // por `rotate`; aqui só se registra, para que alguém possa investigar.
      audit(
        "oauth.reuse_detected",
        { clientId, sessionId: giro.sessionId },
        giro.userId,
        hashIp(ip)
      );
    }
    return erro("invalid_grant", "Sessão inválida. Entre novamente.");
  }

  const emissao = await issueClientTokens({
    userId: claims.sub,
    clientId,
    familyId: claims.fam,
    jti: giro.jti,
    issuedAt: claims.iat,
  });
  if (!emissao.ok) {
    // Senha trocada ou conta excluída derruba o editor e o terminal também,
    // não só o navegador.
    return erro("invalid_grant", "Sessão encerrada. Entre novamente.");
  }

  audit("oauth.refresh", { clientId, sessionId: giro.sessionId }, claims.sub, hashIp(ip));
  return ok(emissao.tokens);
}

/** Rótulo do dispositivo, para a pessoa reconhecer na lista de conectados. */
function rotulo(req: NextRequest): string {
  const ua = req.headers.get("user-agent") || "";
  return ua.slice(0, 120) || "desconhecido";
}
