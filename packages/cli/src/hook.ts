// ============================================================
// `starguard hook install` / `uninstall`.
//
// Instala o hook de pre-commit no repositório atual.
//
// Duas decisões que evitam os erros clássicos de quem mexe em hook:
//
//  1. **Não sobrescreve hook de terceiro sem avisar.** Muito projeto já tem
//     husky, lefthook ou um script próprio no `pre-commit`. Apagá-lo em
//     silêncio quebraria o fluxo do time e a causa seria dificílima de achar.
//  2. **Respeita `core.hooksPath`.** Quem usa husky tem os hooks em `.husky/`,
//     não em `.git/hooks/`. Escrever no lugar errado instalaria um hook que
//     nunca roda — o pior desfecho possível, porque parece que funcionou.
//
// NODE-ONLY.
// ============================================================
import { chmod, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const pExecFile = promisify(execFile);

/** Marca que identifica o hook como NOSSO — é o que autoriza removê-lo. */
const ASSINATURA = "# StarGuard — hook de pre-commit.";

/**
 * Onde os hooks deste repositório moram.
 *
 * `core.hooksPath` é o que husky e lefthook configuram. Ignorá-lo instalaria o
 * hook em `.git/hooks/`, onde o git nem olharia.
 */
async function diretorioDeHooks(raiz: string): Promise<string> {
  const { stdout } = await pExecFile("git", ["config", "--get", "core.hooksPath"], {
    cwd: raiz,
  }).catch(() => ({ stdout: "" }));

  const configurado = stdout.trim();
  if (configurado) return resolve(raiz, configurado);

  const { stdout: gitDir } = await pExecFile("git", ["rev-parse", "--git-dir"], {
    cwd: raiz,
  });
  return resolve(raiz, gitDir.trim(), "hooks");
}

export type ResultadoHook =
  | { ok: true; caminho: string; acao: "instalado" | "atualizado" | "removido" }
  | { ok: false; motivo: "nao_e_repo" | "hook_de_terceiro" | "nao_instalado"; caminho?: string };

export async function instalarHook(raiz: string, conteudo: string): Promise<ResultadoHook> {
  const dentroDeRepo = await pExecFile("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: raiz,
  })
    .then(() => true)
    .catch(() => false);
  if (!dentroDeRepo) return { ok: false, motivo: "nao_e_repo" };

  const dir = await diretorioDeHooks(raiz);
  const caminho = join(dir, "pre-commit");

  const existente = await readFile(caminho, "utf8").catch(() => null);
  if (existente !== null && !existente.includes(ASSINATURA)) {
    // Hook de outra ferramenta. Sobrescrever quebraria o fluxo do time, e o
    // sintoma ("meus testes pararam de rodar no commit") não apontaria para
    // cá. Recusar e explicar é a única saída honesta.
    return { ok: false, motivo: "hook_de_terceiro", caminho };
  }

  await mkdir(dir, { recursive: true });
  await writeFile(caminho, conteudo, "utf8");
  // Hook sem permissão de execução é silenciosamente ignorado pelo git — o
  // modo de falha mais confuso que existe nesta área.
  await chmod(caminho, 0o755).catch(() => {});

  return { ok: true, caminho, acao: existente === null ? "instalado" : "atualizado" };
}

export async function removerHook(raiz: string): Promise<ResultadoHook> {
  const dir = await diretorioDeHooks(raiz).catch(() => null);
  if (!dir) return { ok: false, motivo: "nao_e_repo" };

  const caminho = join(dir, "pre-commit");
  const existente = await readFile(caminho, "utf8").catch(() => null);
  if (existente === null) return { ok: false, motivo: "nao_instalado" };

  // Só removemos o que é nosso: um hook de terceiro que caiu aqui depois da
  // instalação não pode ser apagado por um `uninstall` nosso.
  if (!existente.includes(ASSINATURA)) {
    return { ok: false, motivo: "hook_de_terceiro", caminho };
  }

  await rm(caminho, { force: true });
  return { ok: true, caminho, acao: "removido" };
}

/** O conteúdo do hook, lido do pacote. */
export async function conteudoDoHook(): Promise<string> {
  // Sobe de `dist/` (ou `src/`) para a raiz do pacote e busca em `hooks/`.
  const aqui = new URL("../hooks/pre-commit", import.meta.url);
  const caminho = aqui.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const info = await stat(caminho).catch(() => null);
  if (!info) throw new Error(`Arquivo do hook não encontrado: ${caminho}`);
  return readFile(caminho, "utf8");
}
