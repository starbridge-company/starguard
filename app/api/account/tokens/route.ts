import type { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  readJson,
  requireSession,
  requireCsrf,
} from "@/lib/http";
import { validate, tokenCreateSchema } from "@/lib/validation";
import { parsePageParams } from "@/lib/pagination";
import { audit } from "@/lib/auth";
import * as tokensRepo from "@/lib/repos/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista paginada dos tokens do usuário (nunca retorna o token em claro).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  const p = parsePageParams(req.nextUrl.searchParams);
  const page = await tokensRepo.listForUser(session.sub, p);
  return jsonOk(page);
}

// Cadastra um token novo (cifrado no BD).
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(tokenCreateSchema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  const created = await tokensRepo.createToken(
    session.sub,
    v.data.name,
    v.data.token
  );
  audit("token.create", { userId: session.sub, tokenId: created.id });
  return jsonOk(created, 201);
}
