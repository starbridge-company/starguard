import type { NextRequest } from "next/server";
import { jsonOk } from "@/lib/http";
import { verifyToken } from "@/lib/jwt";
import { clearSessionCookies, revokeRefresh, audit } from "@/lib/auth";
import { COOKIE } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE.refresh)?.value;
  if (token) {
    const claims = await verifyToken(token);
    if (claims?.jti) {
      revokeRefresh(claims.jti); // blocklist
      audit("logout", { userId: claims.sub });
    }
  }
  const res = jsonOk({ ok: true });
  clearSessionCookies(res);
  return res;
}
