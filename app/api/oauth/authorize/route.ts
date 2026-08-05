// ============================================================
// POST /api/oauth/authorize — o "Autorizar" da tela de consentimento.
//
// Só chega aqui quem JÁ está autenticado no navegador: a página
// `/oauth/authorize` manda para o login antes de desenhar qualquer botão. Ou
// seja, este endpoint não autentica ninguém — ele registra uma decisão de quem
// já se autenticou.
//
// Por isso ele exige sessão E CSRF: é um POST com cookie que produz uma
// credencial. Sem CSRF, um site de terceiro poderia disparar a autorização em
// nome de quem estivesse logado, e o código sairia para o `redirect_uri` que o
// atacante escolheu.
// ============================================================
import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireCsrf, requireSession } from "@/lib/http";
import { audit, hashIp } from "@/lib/auth";
import { clientIp } from "@/lib/ratelimit";
import { getClient, redirectUriPermitido } from "@/lib/oauth/clients";
import { isS256 } from "@/lib/oauth/pkce";
import { issueCode } from "@/lib/oauth/codes";
import { validate, oauthAuthorizeSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.", "err.csrf");

  const v = validate(oauthAuthorizeSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message, null);
  const d = v.data;

  if (!getClient(d.clientId)) {
    return jsonError(400, "Cliente desconhecido.", "err.oauthClient");
  }
  // A fronteira do fluxo inteiro: se um destino não-registrado passasse aqui, o
  // código de autorização iria parar na mão de quem controla aquele destino — e
  // o PKCE não salvaria, porque quem escolheu o destino escolheu o verificador.
  if (!redirectUriPermitido(d.clientId, d.redirectUri)) {
    return jsonError(400, "redirect_uri não permitido.", "err.oauthRedirect");
  }
  // `plain` é recusado: nele o desafio É o verificador em texto, e quem
  // intercepta o pedido já tem o que precisa. Ver `lib/oauth/pkce.ts`.
  if (!isS256(d.codeChallengeMethod)) {
    return jsonError(400, "code_challenge_method deve ser S256.", "err.oauthPkce");
  }

  const code = await issueCode({
    userId: session.sub,
    clientId: d.clientId,
    redirectUri: d.redirectUri,
    codeChallenge: d.codeChallenge,
  });

  audit(
    "oauth.authorize",
    { clientId: d.clientId },
    session.sub,
    hashIp(clientIp(req.headers))
  );

  // O `state` volta como veio. Quem confere é o CLIENTE — foi ele que o
  // sorteou, e só ele sabe qual esperava. O servidor não o guarda: guardá-lo
  // seria assumir uma responsabilidade que não fecha o ciclo.
  return jsonOk({ code, state: d.state });
}
