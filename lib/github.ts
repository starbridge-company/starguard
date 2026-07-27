// ============================================================
// GitHub — clone seguro (git via execFile, SEM shell) + metadados e PR (Octokit).
// Anti-SSRF: só github.com (validado em parseGitHubRepo). NODE-ONLY.
// ============================================================
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitHubRepo, type GitHubRepoRef } from "@/lib/validation";
import { redactError } from "@/lib/redact";
import { resolveGitHubToken, requireGitHubToken } from "@/lib/github-auth";

const pExecFile = promisify(execFile);

export class ScanUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanUnavailable";
  }
}

/**
 * Clona o repositório em um diretório temporário descartável (shallow).
 * Usa execFile com array de argumentos — nunca concatena input em shell.
 */
export async function cloneRepo(
  input: string,
  token?: string
): Promise<{ dir: string; ref: GitHubRepoRef }> {
  const ref = parseGitHubRepo(input);
  if (!ref) throw new ScanUnavailable("URL de repositório inválida (allowlist github.com).");

  // O token do servidor só entra quando a instância é de dono único
  // (AUDITORIA.md#SEC-06); caso contrário, clone anônimo — que resolve
  // repositório público e falha com mensagem clara no privado.
  const auth = resolveGitHubToken(token);

  const dir = await mkdtemp(join(tmpdir(), "sg-scan-"));
  // Token vai na URL apenas em memória, como argumento (sem shell).
  const cloneUrl = auth
    ? `https://x-access-token:${auth}@github.com/${ref.owner}/${ref.repo}.git`
    : `${ref.url}.git`;

  try {
    await pExecFile(
      "git",
      [
        "-c",
        "core.askpass=echo",
        "clone",
        "--depth=1",
        "--single-branch",
        "--no-tags",
        cloneUrl,
        dir,
      ],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }
    );

    // `git clone https://token@host/...` grava a URL COM o token no
    // .git/config do clone. O diretório sobrevive durante todo o job (e o
    // agente da Fase 4 lê arquivos ali dentro) — então apagamos a credencial
    // do remote assim que o clone termina. Ver AUDITORIA.md#SEC-01.
    if (auth) {
      await pExecFile("git", ["remote", "set-url", "origin", `${ref.url}.git`], {
        cwd: dir,
        timeout: 15_000,
      }).catch(() => {
        /* sem remote (ou git antigo): o clone segue utilizável */
      });
    }
    return { dir, ref };
  } catch (e) {
    await cleanup(dir);
    // A mensagem do git repete a URL do remote — que carrega o token. Redigir
    // ANTES de propagar: este texto vai para o JSONB `phases` e para a tela.
    const msg = redactError(e);
    if (/not found|command not found|ENOENT/i.test(msg)) {
      throw new ScanUnavailable("git não encontrado no host.");
    }
    // Sem token, repositório privado é indistinguível de inexistente para o
    // git. Dizer isso é mais útil que repetir o "repository not found" cru.
    if (!auth && /authentication|could not read|repository not found|403|404/i.test(msg)) {
      throw new ScanUnavailable(
        "Repositório não encontrado ou privado. Informe um token do GitHub com acesso a ele."
      );
    }
    throw new ScanUnavailable(`Falha ao clonar o repositório: ${msg.slice(0, 200)}`);
  }
}

export async function cleanup(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Busca o conteúdo COMPLETO de um arquivo do repositório via API do GitHub
 * (sem clonar). Usado na Fase 4 para dar à IA o arquivo inteiro na hora de
 * corrigir — o diretório clonado da Fase 3 já foi apagado. Retorna null se o
 * arquivo não existir, for grande demais (>1MB, sem base64) ou der erro.
 */
export async function fetchFileContent(
  repoUrl: string,
  path: string,
  token?: string
): Promise<string | null> {
  const ref = parseGitHubRepo(repoUrl);
  if (!ref) return null;
  const auth = resolveGitHubToken(token);
  const { Octokit } = await import("octokit");
  const octokit = new Octokit(auth ? { auth } : {});
  try {
    const res = await octokit.rest.repos.getContent({
      owner: ref.owner,
      repo: ref.repo,
      path: path.replace(/\\/g, "/"),
    });
    const data = res.data;
    if (Array.isArray(data) || data.type !== "file") return null;
    if (data.encoding !== "base64" || typeof data.content !== "string") return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function getRepoMeta(input: string, token?: string) {
  const ref = parseGitHubRepo(input);
  if (!ref) throw new ScanUnavailable("URL de repositório inválida.");
  const auth = resolveGitHubToken(token);
  const { Octokit } = await import("octokit");
  const octokit = new Octokit(auth ? { auth } : {});
  let data;
  try {
    ({ data } = await octokit.rest.repos.get({
      owner: ref.owner,
      repo: ref.repo,
    }));
  } catch (e) {
    // O GitHub responde 404 (não 403) a repositório privado sem credencial —
    // é de propósito, para não confirmar a existência. Sem token, portanto,
    // "não encontrado" quase sempre significa "privado". Ver AUDITORIA.md#SEC-06.
    const status = (e as { status?: number })?.status;
    if (!auth && (status === 404 || status === 403)) {
      throw new ScanUnavailable(
        "Repositório não encontrado ou privado. Informe um token do GitHub com acesso a ele."
      );
    }
    throw new ScanUnavailable(
      `Falha ao ler o repositório: ${redactError(e).slice(0, 200)}`
    );
  }
  return {
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    private: data.private,
    language: data.language,
    stars: data.stargazers_count,
  };
}

/**
 * Abre um PR com o arquivo corrigido: cria branch a partir do default,
 * grava o novo conteúdo e abre o pull request.
 */
export async function openPullRequest(opts: {
  repoUrl: string;
  file: string;
  fixedCode: string;
  title: string;
  body?: string;
  token?: string;
}): Promise<{ number: number; url: string; branch: string; title: string }> {
  const ref = parseGitHubRepo(opts.repoUrl);
  if (!ref) throw new ScanUnavailable("URL de repositório inválida.");
  // Nunca o token do servidor num deploy multi-usuário (AUDITORIA.md#SEC-06).
  const token = requireGitHubToken(opts.token);

  const { Octokit } = await import("octokit");
  const octokit = new Octokit({ auth: token });
  const { owner, repo } = ref;
  // Paths vêm relativos ao repo; no Windows podem ter "\" — a API exige "/".
  const filePath = opts.file.replace(/\\/g, "/");

  const repoData = await octokit.rest.repos.get({ owner, repo });
  const base = repoData.data.default_branch;
  const baseRef = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const branch = `starguard/fix-${Date.now()}`;
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseRef.data.object.sha,
  });

  // Descobre o sha atual do arquivo (se existir) para atualizar.
  let sha: string | undefined;
  try {
    const existing = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });
    if (!Array.isArray(existing.data) && "sha" in existing.data) {
      sha = existing.data.sha;
    }
  } catch {
    /* arquivo novo */
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    branch,
    message: `fix(security): ${opts.title}`,
    content: Buffer.from(opts.fixedCode, "utf8").toString("base64"),
    sha,
  });

  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title: opts.title,
    head: branch,
    base,
    body:
      opts.body ||
      "Correção de segurança gerada automaticamente pelo StarGuard. Revise antes de mergear.",
  });

  return { number: pr.data.number, url: pr.data.html_url, branch, title: opts.title };
}

/**
 * Abre UM PR consolidado com várias correções: cria uma branch a partir do
 * default e commita cada arquivo nela (um commit por arquivo), depois abre o PR.
 * Arquivos repetidos são deduplicados (o último conteúdo prevalece).
 */
export async function openPullRequestBatch(opts: {
  repoUrl: string;
  files: { file: string; fixedCode: string }[];
  title: string;
  body?: string;
  token?: string;
}): Promise<{
  number: number;
  url: string;
  branch: string;
  title: string;
  committed: number;
}> {
  const ref = parseGitHubRepo(opts.repoUrl);
  if (!ref) throw new ScanUnavailable("URL de repositório inválida.");
  // Nunca o token do servidor num deploy multi-usuário (AUDITORIA.md#SEC-06).
  const token = requireGitHubToken(opts.token);

  const { Octokit } = await import("octokit");
  const octokit = new Octokit({ auth: token });
  const { owner, repo } = ref;

  const repoData = await octokit.rest.repos.get({ owner, repo });
  const base = repoData.data.default_branch;
  const baseRef = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${base}`,
  });
  const branch = `starguard/fix-batch-${Date.now()}`;
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: baseRef.data.object.sha,
  });

  // Dedup por caminho (normalizado p/ "/"); commits sequenciais na mesma branch.
  const seen = new Set<string>();
  let committed = 0;
  for (const f of opts.files) {
    const path = f.file.replace(/\\/g, "/");
    if (seen.has(path)) continue;
    seen.add(path);

    let sha: string | undefined;
    try {
      const existing = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      if (!Array.isArray(existing.data) && "sha" in existing.data) {
        sha = existing.data.sha;
      }
    } catch {
      /* arquivo novo */
    }

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      branch,
      message: `fix(security): ${path}`,
      content: Buffer.from(f.fixedCode, "utf8").toString("base64"),
      sha,
    });
    committed++;
  }

  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title: opts.title,
    head: branch,
    base,
    body:
      opts.body ||
      "Correções de segurança geradas automaticamente pelo StarGuard. Revise antes de mergear.",
  });

  return {
    number: pr.data.number,
    url: pr.data.html_url,
    branch,
    title: opts.title,
    committed,
  };
}
