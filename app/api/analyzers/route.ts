// ============================================================
// O que dá para rodar, e por que não dá o que não dá.
//
// A Tela 1 desenha o seletor a partir daqui. É a MESMA função que o job usa
// para montar o plano (`previewPlan` → `plan()` do núcleo): se divergissem, a
// tela ofereceria um analisador que o job depois recusa, e a pessoa
// descobriria isso só no relatório vazio.
//
// Indisponível volta com `reason` — uma CHAVE, não uma frase. Quem traduz é a
// tela, no idioma de quem está lendo. O mesmo motivo aparece no
// `starguard doctor` e no tooltip da árvore do VS Code.
// ============================================================
import type { NextRequest } from "next/server";
import { jsonOk, jsonError, requireSession } from "@/lib/http";
import { previewPlan } from "@/lib/jobs";
import { getAnalyzer } from "@starguard/core";
import { reasonKey } from "@starguard/core/compat";
import { getLocale } from "@/lib/i18n/server";
import type { AnalyzerId } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AnalyzerInfo {
  id: AnalyzerId;
  /** Chaves de tradução do nome e da descrição. */
  nameKey: string;
  descKey: string;
  available: boolean;
  /** Chave da mensagem que explica a indisponibilidade. */
  reasonKey?: string;
  /** Binário ou modelo — entra na interpolação `{bin}` da mensagem. */
  detail?: string;
  needs: { workspace: boolean; ai: boolean; input?: string[] };
  /** Este analisador sabe corrigir o que encontra? */
  fixable: boolean;
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return jsonError(401, "Não autenticado.");

  // A disponibilidade depende do que a pessoa já preencheu: sem repositório,
  // os que precisam de código aparecem desabilitados com o motivo certo.
  //
  // Os parâmetros são SINALIZADORES de presença, não conteúdo: a descrição do
  // sistema e o texto das skills não trafegam por aqui — para saber se um
  // analisador tem entrada, basta saber que ela existe. `plan()` não clona
  // nem chama IA, então a URL do repositório também é só presença.
  const url = new URL(req.url);
  const repoUrl = url.searchParams.get("repoUrl")?.trim() || undefined;
  const temDescricao = url.searchParams.get("description") === "1";
  const temSkills = url.searchParams.get("skills") === "1";

  const execPlan = await previewPlan({
    // Sem `select`: queremos o diagnóstico de TODOS, não só dos escolhidos.
    repoUrl,
    systemDescription: temDescricao ? "presente" : undefined,
    skills: temSkills ? [{ name: "presente", content: "presente" }] : undefined,
    locale: await getLocale(),
  });

  const analyzers: AnalyzerInfo[] = execPlan.entries.map((e) => {
    const a = getAnalyzer(e.id)!;
    return {
      id: e.id,
      nameKey: `analyzer.${e.id}.name`,
      descKey: `analyzer.${e.id}.desc`,
      available: e.willRun,
      reasonKey: e.willRun ? undefined : reasonKey(e.reason!),
      detail: e.detail,
      needs: {
        workspace: a.needs.workspace,
        ai: a.needs.ai,
        input: a.needs.input,
      },
      fixable: !!a.fix,
    };
  });

  return jsonOk({ analyzers });
}
