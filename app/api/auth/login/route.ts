import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { validate, loginSchema } from "@/lib/validation";
import {
  authenticate,
  issueSession,
  setSessionCookies,
  audit,
  hashIp,
  InfraUnavailable,
} from "@/lib/auth";
import {
  rateLimit,
  peekRateLimit,
  resetRateLimit,
  clientIp,
} from "@/lib/ratelimit";
import { LOGIN_RATE, LOGIN_IP_RATE } from "@/lib/config";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";

export const runtime = "nodejs";

const GENERIC = "E-mail ou senha inválidos.";

function tooMany(resetMs: number) {
  const res = jsonError(
    429,
    "Muitas tentativas de login. Aguarde alguns minutos."
  );
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil(resetMs / 1000))));
  return res;
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const v = validate(loginSchema, body);
  if (!v.ok) return jsonError(401, GENERIC); // genérico: não revela o motivo

  const ip = clientIp(req.headers);
  const email = v.data.email.toLowerCase();
  const accountKey = `login:${email}:${ip}`;
  const ipKey = `login-ip:${ip}`;

  // Cota consultada SEM consumir: login que dá certo não pode gastar cota —
  // era isso que trancava o usuário legítimo fora (AUDITORIA.md#BUG-02).
  const account = await peekRateLimit(accountKey, LOGIN_RATE);
  if (!account.allowed) {
    audit("login.ratelimited", { scope: "account" }, undefined, hashIp(ip));
    return tooMany(account.resetMs);
  }
  const perIp = await peekRateLimit(ipKey, LOGIN_IP_RATE);
  if (!perIp.allowed) {
    audit("login.ratelimited", { scope: "ip" }, undefined, hashIp(ip));
    return tooMany(perIp.resetMs);
  }

  // Banco atrás do código derrubava o login com 500 para QUALQUER senha, e a
  // única pista ficava no log do servidor. Ver AUDITORIA.md#ARQ-12.
  let user;
  try {
    user = await authenticate(v.data.email, v.data.password);
  } catch (e) {
    if (e instanceof InfraUnavailable) {
      console.error(`[login] ${e.message}`);
      return jsonError(
        503,
        e.message,
        e.kind === "schema" ? "err.schemaOutdated" : "err.databaseUnavailable"
      );
    }
    throw e;
  }

  if (!user) {
    // Só a FALHA consome cota — nos dois baldes.
    await rateLimit(accountKey, LOGIN_RATE);
    await rateLimit(ipKey, LOGIN_IP_RATE);
    audit(
      "login.fail",
      { emailDomain: email.split("@")[1] },
      undefined,
      hashIp(ip)
    );
    return jsonError(401, GENERIC);
  }

  // Sucesso limpa o histórico de falhas da conta: quem lembrou a senha não
  // deve arrastar as tentativas anteriores.
  await resetRateLimit(accountKey);

  const session = await issueSession(user);
  const res = jsonOk({
    ok: true,
    user: { email: user.email, role: user.role },
    csrf: session.csrf,
  });
  setSessionCookies(res, session);
  // A preferência de idioma acompanha a CONTA, não o navegador
  // (AUDITORIA.md#PEND-19).
  if (isLocale(user.locale)) {
    res.cookies.set(LOCALE_COOKIE, user.locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "strict",
    });
  }
  audit("login.success", { userId: user.id }, user.id, hashIp(ip));
  return res;
}
