import { jsonOk } from "@/lib/http";

export const runtime = "nodejs";

// Rota pública (allowlist no middleware) — não expõe segredos.
export async function GET() {
  return jsonOk({ status: "ok" });
}
