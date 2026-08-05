// ============================================================
// Workspace — de onde o motor tira o código.
//
// Duas origens, uma interface. O painel web clona um repositório remoto num
// diretório temporário e o descarta no fim; o terminal e a extensão do VS Code
// apontam para um diretório que já existe no disco. Os analisadores não sabem
// a diferença: recebem `root` e leem por caminho relativo.
//
// Um workspace por execução, e não um por analisador — antes, o scan clonava
// para si e a correção clonava outra vez. NODE-ONLY.
// ============================================================
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname, sep, isAbsolute } from "node:path";
import type { Workspace, WorkspaceSource } from "./contracts";
import { parseGitHubRepo } from "./repo-url";
import { ScanUnavailable } from "./git";

/**
 * O caminho relativo cai DENTRO da raiz?
 *
 * `rel` não é dado nosso: vem do relatório de um scanner, do JSON de um
 * modelo, ou do id de um achado gravado meses atrás. Um `../../.ssh/id_rsa`
 * ali dentro transformaria "ler o arquivo do achado" em leitura arbitrária do
 * disco de quem rodou a ferramenta — e no VS Code isso é a máquina de trabalho
 * de uma pessoa. A comparação é feita sobre os caminhos JÁ resolvidos, porque
 * é a resolução que revela o escape.
 */
function confine(root: string, rel: string): string | null {
  // Caminho absoluto nunca é aceito: mesmo que apontasse para dentro da raiz,
  // aceitá-lo tornaria a regra dependente do que veio de fora.
  if (!rel || isAbsolute(rel)) return null;
  const base = resolve(root);
  const alvo = resolve(base, rel);
  if (alvo !== base && !alvo.startsWith(base + sep)) return null;
  return alvo;
}

function makeWorkspace(
  kind: "git" | "local",
  root: string,
  origin: Workspace["origin"],
  dispose: () => Promise<void>
): Workspace {
  let disposed = false;
  return {
    kind,
    root,
    origin,
    async readFile(rel) {
      const alvo = confine(root, rel);
      if (!alvo) return null;
      return readFile(alvo, "utf8").catch(() => null);
    },
    async writeFile(rel, content) {
      const alvo = confine(root, rel);
      if (!alvo) {
        throw new Error(`Caminho fora do workspace, gravação recusada: ${rel}`);
      }
      await mkdir(dirname(alvo), { recursive: true });
      await writeFile(alvo, content, "utf8");
    },
    async dispose() {
      // Idempotente: o orquestrador descarta no `finally`, e quem abriu pode
      // descartar de novo por segurança. Apagar duas vezes não pode explodir.
      if (disposed) return;
      disposed = true;
      await dispose();
    },
  };
}

export async function openWorkspace(
  source: WorkspaceSource
): Promise<Workspace | undefined> {
  if (source.type === "none") return undefined;

  if (source.type === "local") {
    const root = resolve(source.path);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) {
      throw new ScanUnavailable(`Diretório não encontrado: ${source.path}`);
    }
    // Nada a descartar: o diretório é de quem chamou, não nosso.
    return makeWorkspace("local", root, await localOrigin(root), async () => {});
  }

  const { cloneRepo, cleanup } = await import("./git");
  const { dir, ref } = await cloneRepo(source.url, source.token);
  return makeWorkspace(
    "git",
    dir,
    { url: ref.url, owner: ref.owner, repo: ref.repo },
    () => cleanup(dir)
  );
}

/**
 * Descobre o remoto de um diretório local, quando há um.
 *
 * Serve para o terminal e o VS Code oferecerem "abrir Pull Request" sem pedir
 * a URL de novo. Falhar aqui é normal (diretório sem git, sem remoto, remoto
 * que não é GitHub) e não impede analisar nada — só não haverá PR.
 */
async function localOrigin(root: string): Promise<Workspace["origin"]> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const pExecFile = promisify(execFile);
    const { stdout } = await pExecFile(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: root, timeout: 5_000 }
    );
    const bruto = stdout.trim();
    // `git@github.com:org/repo.git` não é URL para o `new URL`; normalizamos
    // para a forma https antes de passar pela allowlist.
    const normal = bruto.startsWith("git@")
      ? "https://" + bruto.slice(4).replace(":", "/")
      : bruto;
    const ref = parseGitHubRepo(normal.replace(/\.git$/, ""));
    return ref ? { url: ref.url, owner: ref.owner, repo: ref.repo } : undefined;
  } catch {
    return undefined;
  }
}
