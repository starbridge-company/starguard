import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession } from "@/lib/http";
import { validate, step2Schema } from "@/lib/validation";
import { validateSkills } from "@/lib/tasks";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const v = validate(step2Schema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  try {
    const result = await validateSkills(v.data.skills);
    return jsonOk({ skills: result });
  } catch {
    return jsonError(502, "Falha ao validar as skills.");
  }
}
