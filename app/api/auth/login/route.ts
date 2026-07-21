import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { validate, loginSchema } from "@/lib/validation";
import {
  authenticate,
  issueSession,
  setSessionCookies,
  audit,
} from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { LOGIN_RATE } from "@/lib/config";

export const runtime = "nodejs";

const GENERIC = "E-mail ou senha inválidos.";

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const v = validate(loginSchema, body);
  if (!v.ok) return jsonError(401, GENERIC); // genérico: não revela o motivo

  const ip = clientIp(req.headers);
  // Rate limit por conta + IP (além do global por IP no middleware).
  const rl = rateLimit(`login:${v.data.email.toLowerCase()}:${ip}`, LOGIN_RATE);
  if (!rl.allowed) {
    audit("login.ratelimited", { ipHash: ip });
    return jsonError(429, "Muitas tentativas. Aguarde alguns minutos.");
  }

  const user = await authenticate(v.data.email, v.data.password);
  if (!user) {
    audit("login.fail", { emailDomain: v.data.email.split("@")[1] });
    return jsonError(401, GENERIC);
  }

  const session = await issueSession(user);
  const res = jsonOk({
    ok: true,
    user: { email: user.email, role: user.role },
    csrf: session.csrf,
  });
  setSessionCookies(res, session);
  audit("login.success", { userId: user.id });
  return res;
}
