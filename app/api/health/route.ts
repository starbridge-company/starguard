import { jsonOk } from "@/lib/http";
import { checkSchema, schemaMessage, MIGRATE_HINT } from "@/lib/schema-check";
import { checkBinaries } from "@/lib/binaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rota pública (allowlist no middleware) — não expõe segredos.
 *
 * Responde 503 quando o banco está atrás do código: era a informação que
 * faltava quando o login começou a devolver 500 sem explicação.
 * Ver AUDITORIA.md#ARQ-12.
 */
export async function GET() {
  const [schema, binaries] = await Promise.all([checkSchema(), checkBinaries()]);

  // Distinguimos "atrasado" de "inalcançável": são consertos diferentes.
  const db = schema.error ? "unreachable" : "ok";
  // Scanner exigido e ausente não derruba a fase (UX-15), mas produz um scan
  // que não escaneia — quem opera precisa ver isso aqui, não num relatório
  // vazio que parece repositório limpo.
  const faltando = binaries.filter((b) => b.required && !b.present);

  const body = {
    status: schema.ok && faltando.length === 0 ? "ok" : "degraded",
    db,
    schema: {
      ok: schema.ok,
      expected: schema.expected,
      applied: schema.applied,
      pending: schema.pending,
    },
    scanners: binaries,
    message: schemaMessage(schema),
    ...(schema.ok ? {} : { hint: MIGRATE_HINT }),
    ...(faltando.length
      ? {
          scannersMessage: `Scanner(s) configurado(s) mas ausente(s) no host: ${faltando
            .map((b) => b.configured)
            .join(", ")}. O scan roda e não encontra nada.`,
        }
      : {}),
  };

  // 503 e não 500: é estado do ambiente, não defeito da aplicação — e é o que
  // um health check de orquestrador entende como "não me mande tráfego".
  return jsonOk(body, schema.ok ? 200 : 503);
}
