// ============================================================
// GitHub — clone seguro (git via execFile, SEM shell) + metadados e PR (Octokit).
// Anti-SSRF: só github.com (validado em parseGitHubRepo). NODE-ONLY.
// ============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitHubRepo, type GitHubRepoRef } from "./repo-url";
import { redactError } from "./redact";
import { resolveGitHubToken, tokenForPullRequest } from "./github-auth";

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
 * O repositório é privado?
 *
 * Consultado SEM credencial de propósito: o GitHub só responde 200 para quem é
 * público. Um 404 aqui significa "privado ou inexistente" — e os dois levam à
 * mesma conclusão para efeito de token: precisa ser o do usuário.
 *
 * Cache curto porque isto roda a cada tentativa de abrir PR e a visibilidade
 * de um repositório quase nunca muda no meio de uma sessão.
 */
const visCache = new Map<string, { at: number; privado: boolean }>();
const VIS_TTL_MS = 5 * 60_000;

export async function isPrivateRepo(repoUrl: string): Promise<boolean> {
  const ref = parseGitHubRepo(repoUrl);
  if (!ref) return true; // não deu para checar: trata como privado (mais restrito)

  const cached = visCache.get(ref.url);
  if (cached && Date.now() - cached.at < VIS_TTL_MS) return cached.privado;

  const { Octokit } = await import("octokit");
  const anon = new Octokit();
  let privado = true;
  try {
    const { data } = await anon.rest.repos.get({
      owner: ref.owner,
      repo: ref.repo,
    });
    privado = !!data.private;
  } catch {
    // 404 anônimo = não é público. Falha de rede também cai aqui, e tratar
    // como privado é o lado seguro: no máximo pedimos um token a mais.
    privado = true;
  }
  visCache.set(ref.url, { at: Date.now(), privado });
  return privado;
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
  // Público: o token do servidor abre o PR. Privado: exige o token do
  // usuário — emprestar o do servidor aqui é o furo do AUDITORIA.md#SEC-06.
  const token = tokenForPullRequest({
    userToken: opts.token,
    isPrivate: await isPrivateRepo(opts.repoUrl),
  });

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
  // Público: o token do servidor abre o PR. Privado: exige o token do
  // usuário — emprestar o do servidor aqui é o furo do AUDITORIA.md#SEC-06.
  const token = tokenForPullRequest({
    userToken: opts.token,
    isPrivate: await isPrivateRepo(opts.repoUrl),
  });

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

  // Dedup por caminho (normalizado p/ "/"). O ÚLTIMO conteúdo vence: quando o
  // mesmo arquivo aparece duas vezes, a versão mais recente já acumula as
  // correções anteriores.
  const porCaminho = new Map<string, string>();
  for (const f of opts.files) {
    porCaminho.set(f.file.replace(/\\/g, "/"), f.fixedCode);
  }
  const arquivos = [...porCaminho.entries()];

  // ------------------------------------------------------------
  // Um commit só, via Git Data API.
  //
  // Antes era `createOrUpdateFileContents` num laço: DUAS chamadas por arquivo
  // (ler o sha + gravar) e um commit por arquivo, tudo em série. Para os 33
  // arquivos de um lote real isso dava 66 idas ao GitHub e mais de um minuto
  // de espera — além de poluir o histórico com 33 commits "fix(security): …".
  //
  // Agora: blobs em PARALELO, uma árvore, um commit, um update de ref. O
  // tempo passa a depender do arquivo mais lento, não da soma de todos.
  // ------------------------------------------------------------
  const baseCommit = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseRef.data.object.sha,
  });

  const CONCORRENCIA = 8;
  const blobs: { path: string; sha: string }[] = [];
  for (let i = 0; i < arquivos.length; i += CONCORRENCIA) {
    const lote = arquivos.slice(i, i + CONCORRENCIA);
    const shas = await Promise.all(
      lote.map(async ([path, conteudo]) => {
        const { data } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(conteudo, "utf8").toString("base64"),
          encoding: "base64",
        });
        return { path, sha: data.sha };
      })
    );
    blobs.push(...shas);
  }

  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.data.tree.sha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: b.sha,
    })),
  });

  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: `fix(security): ${arquivos.length} arquivo(s) — ${opts.title}`,
    tree: tree.data.sha,
    parents: [baseRef.data.object.sha],
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });

  const committed = arquivos.length;

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
