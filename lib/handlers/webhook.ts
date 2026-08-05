// ============================================================
// Handler de job: analisar o que mudou e abrir o PR de correções.
//
// É o trabalho que o webhook enfileirou. Roda no worker, fora da requisição —
// pode levar minutos sem que ninguém espere.
//
// **A decisão que define o custo:** semgrep e trivy rodam no repositório
// INTEIRO (são rápidos e não custam IA); a correção olha só o que MUDOU. Num
// repositório ativo, analisar tudo com IA a cada commit multiplicaria a fatura
// por algo que ninguém pediu — e os achados de código que não foi tocado já
// aparecem no painel.
//
// O PR de correções é aberto como `starguard[bot]`, com installation token de
// uma hora, e SEMPRE separado do commit original: ninguém tem código alterado
// por baixo. Quem revisa decide.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { JobRow } from "@/lib/queue";
import { installationToken } from "@/lib/github-app";
import { log } from "@starguard/core/logger";
import { redactError } from "@starguard/core/redact";
import { audit } from "@/lib/auth";

const pExecFile = promisify(execFile);

interface Carga {
  trigger: "pull_request" | "push";
  installationId: number;
  repo: string;
  headSha: string;
  beforeSha?: string;
  baseRef?: string;
  prNumber?: number;
  branch?: string;
}

export async function handleWebhook(job: JobRow): Promise<void> {
  const c = job.payload as unknown as Carga;
  if (!c?.repo || !c.headSha) throw new Error("Payload de webhook incompleto.");

  const token = await installationToken(c.installationId);
  const alterados = await arquivosAlterados(c, token);

  if (!alterados.length) {
    log.info("webhook.noSource", { engine: c.repo });
    return;
  }

  const dir = await clonar(c, token);
  try {
    const { analyze } = await import("@starguard/core");
    const run = await analyze({
      // `threat` fica de fora: ele parte da descrição do sistema, que um
      // webhook não tem. `skills` idem — não há skill a validar num push.
      select: ["sast", "sca", "business"],
      source: { type: "local", path: dir },
      locale: "pt-BR",
    });

    const { achadosNoDiff, abrirPrDeCorrecoes } = await import("@/lib/handlers/fix-pr");
    // O filtro pelo diff acontece DEPOIS da análise: os scanners já rodaram no
    // repositório inteiro (é barato), e o que se economiza é a IA da correção.
    const alvos = achadosNoDiff(run, alterados);

    if (!alvos.length) {
      log.info("webhook.clean", { engine: c.repo });
      audit("github.webhook.clean", { repo: c.repo, sha: c.headSha });
      return;
    }

    const pr = await abrirPrDeCorrecoes({
      repo: c.repo,
      token,
      dir,
      baseRef: c.branch ?? c.baseRef ?? "main",
      achados: alvos,
      origem: c.trigger === "pull_request" ? `PR #${c.prNumber}` : `commit ${c.headSha.slice(0, 7)}`,
    });

    audit("github.webhook.pr", {
      repo: c.repo,
      sha: c.headSha,
      pr: pr?.number,
      achados: alvos.length,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Quais arquivos mudaram.
 *
 * Vem da API do GitHub e não de `git diff` local porque o clone é raso: num
 * `--depth=1` o commit anterior nem existe para comparar. Pedir ao GitHub é
 * uma chamada e devolve exatamente o que se quer.
 */
async function arquivosAlterados(c: Carga, token: string): Promise<string[]> {
  const base = `https://api.github.com/repos/${c.repo}`;
  const url =
    c.trigger === "pull_request"
      ? `${base}/pulls/${c.prNumber}/files?per_page=100`
      : `${base}/compare/${c.beforeSha}...${c.headSha}`;

  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ao listar arquivos alterados.`);
  }

  const j = (await res.json()) as
    | Array<{ filename?: string; status?: string }>
    | { files?: Array<{ filename?: string; status?: string }> };
  const lista = Array.isArray(j) ? j : (j.files ?? []);

  return lista
    // Arquivo REMOVIDO não tem o que corrigir, e um achado nele seria de código
    // que já não existe.
    .filter((f) => f.status !== "removed" && f.filename)
    .map((f) => f.filename!.replace(/\\/g, "/"));
}

/**
 * Clona o commit exato que disparou o evento.
 *
 * O SHA e não a branch: entre o webhook e o worker pegar o job, alguém pode ter
 * empurrado de novo — e analisar um código diferente do que gerou o evento
 * produziria um PR que não corresponde a nada.
 */
async function clonar(c: Carga, token: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sg-hook-"));
  const url = `https://x-access-token:${token}@github.com/${c.repo}.git`;
  try {
    await pExecFile(
      "git",
      ["-c", "core.askpass=echo", "clone", "--depth=1", "--no-tags", url, dir],
      { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 }
    );
    await pExecFile("git", ["fetch", "--depth=1", "origin", c.headSha], {
      cwd: dir,
      timeout: 120_000,
    });
    await pExecFile("git", ["checkout", c.headSha], { cwd: dir, timeout: 60_000 });

    // O token vai na URL e o `git clone` o grava em `.git/config`. O diretório
    // sobrevive durante todo o job — apagamos a credencial do remote assim que
    // o clone termina. Ver AUDITORIA.md#SEC-01.
    await pExecFile(
      "git",
      ["remote", "set-url", "origin", `https://github.com/${c.repo}.git`],
      { cwd: dir, timeout: 15_000 }
    ).catch(() => {});

    return dir;
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    // Redigido: a mensagem do git repete a URL do remote, que carrega o token.
    throw new Error(`Falha ao clonar ${c.repo}: ${redactError(e).slice(0, 200)}`);
  }
}
