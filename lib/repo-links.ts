// ============================================================
// Link do achado para a linha exata no GitHub. Ver AUDITORIA.md#UX-08.
//
// O card mostrava `file` e `line` como texto; para ver o contexto real o
// usuário abria o GitHub e navegava à mão.
//
// Usamos `blob/HEAD/...`: o GitHub resolve `HEAD` para o branch padrão do
// repositório, o que evita persistir o `defaultBranch` em cada análise. O
// preço é que o link aponta para o código de AGORA, que pode ter mudado desde
// o scan — daí `atCurrentHead` no retorno, para a UI poder avisar.
//
// Isomórfico: a montagem é feita no cliente, onde o card é renderizado.
// ============================================================
import { parseGitHubRepo } from "@/lib/validation";

export interface RepoFileLink {
  url: string;
  atCurrentHead: true;
}

/**
 * URL do arquivo (opcionalmente com a faixa de linhas destacada) no GitHub.
 * Devolve `null` quando não dá para montar um link confiável — repositório
 * ausente, fora da allowlist, ou caminho que o scanner não soube informar.
 */
export function repoFileLink(
  repoUrl: string | null | undefined,
  file: string | null | undefined,
  line?: number,
  endLine?: number
): RepoFileLink | null {
  if (!repoUrl || !file) return null;

  const ref = parseGitHubRepo(repoUrl);
  if (!ref) return null;

  // Caminhos vêm relativos ao repo e, no Windows, com "\".
  const path = file.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
  if (!path) return null;
  // `desconhecido` é o que o mapeamento da revisão por IA usa quando o modelo
  // não informou arquivo — linkar para isso daria 404.
  if (path === "desconhecido" || path === "unknown") return null;
  // Sair do repositório com `..` nunca é um caminho legítimo de achado.
  if (path.split("/").includes("..")) return null;

  const encoded = path.split("/").map(encodeURIComponent).join("/");
  let url = `${ref.url}/blob/HEAD/${encoded}`;

  // Âncora de linha: só quando o scanner localizou de fato (linha 0 = não sabe).
  if (line && line > 0) {
    url += `#L${line}`;
    if (endLine && endLine > line) url += `-L${endLine}`;
  }

  return { url, atCurrentHead: true };
}
