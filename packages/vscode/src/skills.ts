// ============================================================
// De onde sai a skill que o analisador lê — AUDITORIA.md#UX-23.
//
// O painel não tinha campo nenhum para isto: a única entrada possível era o
// arquivo aberto no editor, e quem quisesse validar um `prompts.md` que não
// estivesse aberto não tinha onde clicar — o cartão ficava cinza com "sem
// entrada" e a tela não oferecia saída. Agora a escolha é explícita, e o
// editor aberto continua valendo como atalho.
//
// A decisão mora aqui, separada de `extension.ts`, porque é lógica pura e
// porque foi ela que escondeu um bug: o filtro antigo (`!doc.isUntitled`)
// aceitava QUALQUER documento do editor. Um canal de saída (`output:`), o diff
// virtual da correção (`starguard-diff:`) ou a tela de configurações
// (`vscode-userdata:`) são documentos de texto como outro qualquer para a API
// — e viravam "a skill a validar" sem ninguém perceber, porque o resultado
// saía com cara de análise legítima.
// ============================================================

/** O documento aberto, reduzido ao que decide se ele é uma skill. */
export interface DocumentoAberto {
  /** `uri.scheme` — é ele que separa arquivo de painel de saída. */
  esquema: string;
  /** `uri.fsPath`. */
  caminho: string;
  semTitulo: boolean;
}

export type FonteDeSkills =
  | { tipo: "escolhidos"; caminhos: string[] }
  | { tipo: "editor"; caminho: string }
  | { tipo: "nenhuma" };

/**
 * Esquemas que representam um arquivo de verdade, em disco ou no sistema de
 * arquivos remoto. `file` cobre o caso local e o Remote SSH/Containers (lá o
 * extension host é o outro lado); `vscode-vfs` é o github.dev.
 *
 * Tudo o mais — `output`, `git`, `vscode-userdata`, `untitled`,
 * `starguard-diff` — é tela, não arquivo.
 */
const ESQUEMAS_DE_ARQUIVO = new Set(["file", "vscode-vfs", "vscode-remote"]);

export function ehArquivoDeVerdade(doc?: DocumentoAberto | null): boolean {
  if (!doc || doc.semTitulo) return false;
  return ESQUEMAS_DE_ARQUIVO.has(doc.esquema) && !!doc.caminho.trim();
}

/**
 * O que o analisador de skills vai ler.
 *
 * A escolha explícita GANHA do editor aberto: quem apontou o arquivo o fez uma
 * vez e não deve ver o resultado mudar porque trocou de aba no meio do
 * caminho. O editor é o atalho de quem não escolheu nada.
 */
export function fonteDeSkills(opts: {
  escolhidos: readonly string[];
  aberto?: DocumentoAberto | null;
}): FonteDeSkills {
  const escolhidos = opts.escolhidos.filter((c) => c.trim());
  if (escolhidos.length) return { tipo: "escolhidos", caminhos: [...escolhidos] };
  if (ehArquivoDeVerdade(opts.aberto)) {
    return { tipo: "editor", caminho: opts.aberto!.caminho };
  }
  return { tipo: "nenhuma" };
}

/** Acrescenta sem repetir e preservando a ordem de escolha. */
export function acrescentar(
  escolhidos: readonly string[],
  novos: readonly string[]
): string[] {
  // O conjunto cresce durante a passada: escolher o mesmo arquivo duas vezes
  // no MESMO diálogo é tão possível quanto escolhê-lo de novo depois.
  const vistos = new Set(escolhidos);
  const fim: string[] = [];
  for (const c of novos) {
    if (!c.trim() || vistos.has(c)) continue;
    vistos.add(c);
    fim.push(c);
  }
  return [...escolhidos, ...fim];
}

/** Só o nome do arquivo — o caminho inteiro não cabe numa barra lateral. */
export function nomeDe(caminho: string): string {
  return caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho;
}
