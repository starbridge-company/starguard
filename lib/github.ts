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

  const dir = await mkdtemp(join(tmpdir(), "sg-scan-"));
  // Token vai na URL apenas em memória, como argumento (sem shell).
  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${ref.owner}/${ref.repo}.git`
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
    return { dir, ref };
  } catch (e) {
    await cleanup(dir);
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|command not found|ENOENT/i.test(msg)) {
      throw new ScanUnavailable("git não encontrado no host.");
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
  const auth = token || process.env.GITHUB_TOKEN;
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
  const { Octokit } = await import("octokit");
  const octokit = new Octokit({ auth: token || process.env.GITHUB_TOKEN });
  const { data } = await octokit.rest.repos.get({
    owner: ref.owner,
    repo: ref.repo,
  });
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
  const token = opts.token || process.env.GITHUB_TOKEN;
  if (!token) throw new ScanUnavailable("GITHUB_TOKEN ausente para abrir PR.");

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
  const token = opts.token || process.env.GITHUB_TOKEN;
  if (!token) throw new ScanUnavailable("GITHUB_TOKEN ausente para abrir PR.");

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
