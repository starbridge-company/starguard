import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { validate, loginSchema } from "@/lib/validation";
import {
  authenticate,
  issueSession,
  setSessionCookies,
  audit,
  hashIp,
} from "@/lib/auth";
import {
  rateLimit,
  peekRateLimit,
  resetRateLimit,
  clientIp,
} from "@/lib/ratelimit";
import { LOGIN_RATE, LOGIN_IP_RATE } from "@/lib/config";

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
  const account = peekRateLimit(accountKey, LOGIN_RATE);
  if (!account.allowed) {
    audit("login.ratelimited", { scope: "account" }, undefined, hashIp(ip));
    return tooMany(account.resetMs);
  }
  const perIp = peekRateLimit(ipKey, LOGIN_IP_RATE);
  if (!perIp.allowed) {
    audit("login.ratelimited", { scope: "ip" }, undefined, hashIp(ip));
    return tooMany(perIp.resetMs);
  }

  const user = await authenticate(v.data.email, v.data.password);
  if (!user) {
    // Só a FALHA consome cota — nos dois baldes.
    rateLimit(accountKey, LOGIN_RATE);
    rateLimit(ipKey, LOGIN_IP_RATE);
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
  resetRateLimit(accountKey);

  const session = await issueSession(user);
  const res = jsonOk({
    ok: true,
    user: { email: user.email, role: user.role },
    csrf: session.csrf,
  });
  setSessionCookies(res, session);
  audit("login.success", { userId: user.id }, user.id, hashIp(ip));
  return res;
}
