import type { NextRequest } from "next/server";
import { jsonError, requireSession, canAccess } from "@/lib/http";
import { validate, uuidField } from "@/lib/validation";
import { getAnalysis, getAnalysisOwner } from "@/lib/jobs";
import { audit } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import {
  exportAnalysis,
  exportFilename,
  isExportFormat,
  CONTENT_TYPE,
} from "@starguard/core/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exporta os achados de uma análise. Ver AUDITORIA.md#UX-10.
 *
 *   GET /api/analyses/:id/export?format=sarif|csv|json
 *
 * SARIF 2.1.0 é o formato que o GitHub Code Scanning consome direto; CSV vai
 * para planilha; JSON é o dado bruto para pipeline.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  const format = req.nextUrl.searchParams.get("format") ?? "sarif";
  if (!isExportFormat(format)) {
    return jsonError(400, "Formato inválido. Use sarif, csv ou json.", "err.badExportFormat");
  }

  const { id } = await params;
  if (!validate(uuidField, id).ok) {
    return jsonError(404, "Análise não encontrada.");
  }

  const owner = await getAnalysisOwner(id);
  if (!owner || !canAccess(session, owner)) {
    return jsonError(404, "Análise não encontrada.");
  }

  const job = await getAnalysis(id);
  if (!job) return jsonError(404, "Análise não encontrada.");

  // O arquivo baixado é lido por uma PESSOA (SARIF no GitHub, CSV no Excel):
  // sai no idioma dela, não no do servidor. Ver AUDITORIA.md#FEAT-04.
  const body = exportAnalysis(job, format, await getLocale());
  const filename = exportFilename(job, format);

  audit("analysis.export", { userId: session.sub, analysisId: id, format });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE[format],
      // `attachment` para o navegador baixar em vez de renderizar — e o nome
      // já vem sanitizado por `exportFilename`.
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
