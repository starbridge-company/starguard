// ============================================================
// POST /api/github/webhook — os gatilhos automáticos.
//
// Rota PÚBLICA por definição: o GitHub não faz login. A única barreira é a
// assinatura HMAC, e por isso ela é a primeira coisa que acontece aqui — antes
// de parsear, antes de olhar o evento, antes de qualquer trabalho.
//
// A regra que define o desenho: **responder rápido, trabalhar depois.** O
// GitHub espera 2xx em segundos e reenvia se não receber; a análise leva
// minutos. Então esta rota só enfileira e responde. Sem a fila (Etapa C), este
// endpoint não poderia existir.
//
// Eventos tratados:
//   pull_request  (opened, synchronize, reopened) → análise do diff do PR
//   push          (só na branch padrão)           → análise do diff do commit
//   installation  (deleted)                       → esquece o token em cache
// ============================================================
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appConfig, esquecerInstalacao, verificarAssinatura } from "@/lib/github-app";
import { enqueue } from "@/lib/queue";
import { log } from "@starguard/core/logger";
import { audit } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resposta(status: number, body: Record<string, unknown>): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest) {
  const cfg = appConfig();
  if (!cfg) {
    // Instalação que não usa os gatilhos automáticos é legítima. 503 diz "não
    // estou configurado para isto", que é diferente de "recusei você".
    return resposta(503, { error: "GitHub App não configurado." });
  }

  // O corpo CRU, e não o JSON reserializado: o HMAC é sobre os bytes exatos
  // que o GitHub assinou, e reserializar muda espaço e ordem de chave.
  const corpoCru = await req.text();

  if (!verificarAssinatura(corpoCru, req.headers.get("x-hub-signature-256"), cfg.webhookSecret)) {
    // Não distinguimos "sem assinatura" de "assinatura errada": as duas são a
    // mesma coisa do ponto de vista de quem não deveria estar aqui.
    log.warn("webhook.badSignature", {});
    return resposta(401, { error: "Assinatura inválida." });
  }

  const evento = req.headers.get("x-github-event") ?? "";
  const entrega = req.headers.get("x-github-delivery") ?? "";

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(corpoCru) as Record<string, unknown>;
  } catch {
    return resposta(400, { error: "Corpo inválido." });
  }

  const installationId = Number(
    (payload.installation as { id?: number } | undefined)?.id ?? 0
  );

  try {
    const enfileirado = await tratar(evento, payload, installationId, entrega);
    // 202 e não 200: o trabalho foi ACEITO, não concluído. É o código honesto
    // para "enfileirei", e o GitHub trata os dois como sucesso.
    return resposta(202, { accepted: enfileirado });
  } catch (e) {
    log.error("webhook.failed", { engine: evento, error: e });
    // 500 faz o GitHub reenviar — que é o que se quer quando a falha é nossa
    // e transitória (banco momentaneamente fora do ar).
    return resposta(500, { error: "Falha ao enfileirar." });
  }
}

async function tratar(
  evento: string,
  payload: Record<string, unknown>,
  installationId: number,
  entrega: string
): Promise<boolean> {
  if (evento === "ping") return false;

  if (evento === "installation" && payload.action === "deleted") {
    // O App foi desinstalado: o token em cache não vale mais nada e não deve
    // sobreviver na memória do processo.
    esquecerInstalacao(installationId);
    audit("github.app.uninstalled", { installationId });
    return false;
  }

  if (evento === "pull_request") {
    const acao = String(payload.action ?? "");
    // `synchronize` = alguém empurrou commits novos no PR. É o gatilho de
    // "PR atualizado" que você pediu.
    if (!["opened", "synchronize", "reopened"].includes(acao)) return false;

    const pr = payload.pull_request as {
      number?: number;
      head?: { sha?: string; ref?: string };
      base?: { ref?: string };
      draft?: boolean;
    };
    // Rascunho não é pedido de revisão: analisar (e cobrar IA) num PR que a
    // pessoa ainda está montando é gastar dinheiro em trabalho inacabado.
    if (pr?.draft) return false;

    const repo = repoDe(payload);
    if (!repo || !pr?.number) return false;

    await enqueue({
      kind: "webhook",
      payload: {
        trigger: "pull_request",
        installationId,
        repo,
        prNumber: pr.number,
        headSha: pr.head?.sha,
        headRef: pr.head?.ref,
        baseRef: pr.base?.ref,
        delivery: entrega,
      },
      // Dedupe pelo SHA: o GitHub reenvia quando não recebe 2xx a tempo, e
      // dois pushes seguidos no mesmo PR não devem gerar duas análises do
      // mesmo estado. Pelo SHA e não pelo número do PR, senão um push novo
      // (que É trabalho novo) seria descartado como duplicata.
      dedupeKey: `pr:${repo}:${pr.head?.sha}`,
    });
    return true;
  }

  if (evento === "push") {
    const ref = String(payload.ref ?? "");
    const branchPadrao = String(
      (payload.repository as { default_branch?: string } | undefined)?.default_branch ?? "main"
    );
    // Só a branch padrão. Analisar todo push de toda branch multiplicaria a
    // conta de IA por algo que o gatilho de PR já cobre.
    if (ref !== `refs/heads/${branchPadrao}`) return false;
    // Push que APAGA a branch não tem o que analisar.
    if (payload.deleted === true) return false;

    const repo = repoDe(payload);
    const after = String(payload.after ?? "");
    if (!repo || !after || /^0+$/.test(after)) return false;

    await enqueue({
      kind: "webhook",
      payload: {
        trigger: "push",
        installationId,
        repo,
        headSha: after,
        beforeSha: payload.before,
        branch: branchPadrao,
        delivery: entrega,
      },
      dedupeKey: `push:${repo}:${after}`,
    });
    return true;
  }

  return false;
}

function repoDe(payload: Record<string, unknown>): string | null {
  const r = payload.repository as { full_name?: string } | undefined;
  return r?.full_name ?? null;
}
