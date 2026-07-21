import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, step4Schema } from "@/lib/validation";
import { generateFix } from "@/lib/tasks";
import { audit } from "@/lib/auth";

export const runtime = "nodejs";
// O engine de agente (FIX_ENGINE=agent) pode levar minutos: clona o repo e roda
// o Claude Agent SDK. Damos a mesma folga do scan.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(step4Schema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  try {
    const fix = await generateFix(v.data);
    audit("fix.generate", { userId: session.sub, vuln: v.data.vulnerabilityId });
    return jsonOk(fix);
  } catch {
    return jsonError(502, "Falha ao gerar a correção.");
  }
}
