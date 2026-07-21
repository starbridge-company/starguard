import { jsonOk } from "@/lib/http";
import { DEMO_MODE } from "@/lib/config";

export const runtime = "nodejs";

// Rota pública (allowlist no middleware) — não expõe segredos.
export async function GET() {
  return jsonOk({ status: "ok", demo: DEMO_MODE });
}
