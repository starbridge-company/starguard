import type { NextRequest } from "next/server";
import { jsonOk } from "@/lib/http";
import { verifyToken } from "@/lib/jwt";
import { clearSessionCookies, revokeRefresh, audit, hashIp } from "@/lib/auth";
import { clientIp } from "@/lib/ratelimit";
import { COOKIE } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE.refresh)?.value;
  if (token) {
    const claims = await verifyToken(token);
    if (claims?.jti) {
      await revokeRefresh(claims.jti, {
        userId: claims.sub,
        expiresAt: new Date(claims.exp * 1000),
      }); // blocklist
      audit("logout", { userId: claims.sub }, claims.sub, hashIp(clientIp(req.headers)));
    }
  }
  const res = jsonOk({ ok: true });
  clearSessionCookies(res);
  return res;
}
