import type { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  readJson,
  requireSession,
  requireCsrf,
  canAccess,
} from "@/lib/http";
import { validate, step4Schema } from "@/lib/validation";
import { generateFix } from "@/lib/tasks";
import { audit } from "@/lib/auth";
import { AI_BY_PHASE, FIX_AGENT } from "@/lib/config";
import * as findingsRepo from "@/lib/repos/findings";
import { getLocale } from "@/lib/i18n/server";
import { log } from "@/lib/logger";

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

  // O achado pode vir identificado pelo id persistido OU pelo par
  // (análise, id local). O segundo caminho existe porque a tela carrega o mapa
  // de ids de forma assíncrona: se a geração começa antes, a requisição sairia
  // sem identificação e QUEBRARIA os dois lados do FEAT-02 — não consultaria o
  // cache (gastando IA de novo) e não guardaria o resultado (gastando outra
  // vez na próxima abertura). Resolver no servidor tira a tela dessa corrida.
  let finding = v.data.findingId
    ? await findingsRepo.getById(v.data.findingId)
    : undefined;

  if (!finding && v.data.analysisId) {
    finding = await findingsRepo.getByLocalId(
      v.data.analysisId,
      v.data.vulnerabilityId
    );
  }

  if (v.data.findingId || finding) {
    if (!finding) return jsonError(404, "Achado não encontrado.");
    const owner = await findingsRepo.ownerOfFinding(finding.id);
    if (!owner || !canAccess(session, owner)) {
      return jsonError(404, "Achado não encontrado.");
    }

    // Correção já gerada é REAPROVEITADA. Antes, reabrir o modal disparava
    // uma nova chamada de IA (e, com o engine de agente, um novo clone do
    // repositório) — só para mostrar de novo o que já existia.
    // Ver AUDITORIA.md#FEAT-02.
    if (!v.data.force) {
      const cached = await findingsRepo.getLatestFix(finding.id);
      if (cached) {
        audit("fix.cached", { userId: session.sub, findingId: finding.id });
        return jsonOk({ ...cached, cached: true });
      }
    }
  }

  try {
    const fix = await generateFix({ ...v.data, locale: await getLocale() });

    if (finding) {
      await findingsRepo
        .saveFix(finding.id, fix, {
          model: FIX_AGENT.model || AI_BY_PHASE.refactor.model,
          instructions: v.data.userInstructions,
          by: session.sub,
        })
        .catch((e) => {
          // A correção já foi gerada — não vamos perder a resposta por falha
          // de escrita. Mas engolir em SILÊNCIO era pior: o usuário pagaria a
          // IA de novo na próxima abertura e nada indicaria o porquê.
          log.error("fix.save.failed", {
            userId: session.sub,
            findingId: finding.id,
            engine: fix.engine,
            error: e,
          });
        });
    }

    audit("fix.generate", {
      userId: session.sub,
      vuln: v.data.vulnerabilityId,
      regenerated: !!v.data.force,
    });
    return jsonOk({ ...fix, cached: false });
  } catch (e) {
    // Mensagem da IA (ex.: "não devolveu código corrigido") é acionável para
    // quem está na tela — melhor que um 502 mudo.
    const msg =
      e instanceof Error && e.name === "AIError"
        ? e.message
        : "Falha ao gerar a correção.";
    return jsonError(502, msg);
  }
}
