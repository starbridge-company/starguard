import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession } from "@/lib/http";
import { validate, step1Schema } from "@/lib/validation";
import { generateThreatModel } from "@/lib/tasks";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const v = validate(step1Schema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  try {
    const model = await generateThreatModel(v.data.systemDescription);
    return jsonOk(model);
  } catch {
    return jsonError(502, "Falha ao gerar a modelagem de ameaças.");
  }
}
