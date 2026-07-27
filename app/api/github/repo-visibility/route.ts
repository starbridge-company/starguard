import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession } from "@/lib/http";
import { validate, githubUrlField } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O repositório é privado?
 *
 * Serve para a tela saber ANTES do clique se vai precisar de token. Sem isto,
 * o único jeito de descobrir era tentar abrir o PR e falhar — o usuário via um
 * spinner, um erro, e só então o seletor de token. Uma ida perdida ao servidor
 * para produzir confusão.
 *
 * Não expõe nada: a visibilidade de um repositório no GitHub é pública, e a
 * consulta que fazemos é anônima. A allowlist do `githubUrlField` mantém a
 * proteção anti-SSRF.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const v = validate(githubUrlField, req.nextUrl.searchParams.get("repoUrl"));
  if (!v.ok) return jsonError(400, v.message);

  const { isPrivateRepo } = await import("@/lib/github");
  return jsonOk({ private: await isPrivateRepo(v.data) });
}
