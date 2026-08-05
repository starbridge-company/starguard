// ============================================================
// Dispositivos conectados — listar e revogar.
//
// É a contrapartida obrigatória de emitir credencial de trinta dias: quem
// conectou precisa conseguir desconectar, sem depender de suporte. Também é o
// que dá ação a quem descobre um `oauth.reuse_detected` na trilha.
//
// GET /api/oauth/sessions        lista as ATIVAS de quem está autenticado
// DELETE /api/oauth/sessions/[id] revoga uma (arquivo vizinho, na convenção
//                                 que o app já usa em /api/account/tokens/[id])
// ============================================================
import type { NextRequest } from "next/server";
import { jsonError, jsonOk, requireSession } from "@/lib/http";
import { listActive } from "@/lib/oauth/sessions";
import { getClient } from "@/lib/oauth/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const sessoes = await listActive(session.sub);
  return jsonOk({
    sessions: sessoes.map((s) => ({
      id: s.id,
      clientId: s.clientId,
      // O nome do cliente é CHAVE, não texto: a lista é lida no idioma de quem
      // está na tela.
      nameKey: getClient(s.clientId)?.nameKey ?? "oauth.client.unknown",
      label: s.label,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
    })),
  });
}
