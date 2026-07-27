import type { NextRequest } from "next/server";
import { jsonError, jsonOk, readJson, requireSession, requireCsrf } from "@/lib/http";
import { validate, step3Schema } from "@/lib/validation";
import { redact } from "@/lib/redact";
import { runScan } from "@/lib/tasks";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");
  if (!requireCsrf(req)) return jsonError(403, "Token CSRF inválido.");

  const v = validate(step3Schema, await readJson(req));
  if (!v.ok) return jsonError(400, v.message);

  try {
    // Requisitos chegam como texto nesta rota standalone; viram Requirement[]
    // com ids sequenciais para a revisão referenciar via requirementRefs.
    const requirements = (v.data.requirements || []).map((text, i) => ({
      id: `R-${i + 1}`,
      category: "",
      text,
    }));
    const result = await runScan(v.data.repoUrl, v.data.token, {
      systemDescription: v.data.systemDescription,
      requirements,
    });
    return jsonOk(result);
  } catch (e) {
    const msg = e instanceof Error ? redact(e.message) : "Falha no scan.";
    return jsonError(502, msg);
  }
}
