// ============================================================
// Correção em LOTE — AUDITORIA.md#UX-24.
//
// Corrigir um achado por vez é trabalho de máquina cobrado da pessoa: numa
// varredura real deste repositório os achados se concentram em poucos
// arquivos, e clicar em "corrigir" cinquenta vezes não é revisão, é digitação.
//
// A regra que sustenta este arquivo é uma só, e ela custou um bug para ser
// aprendida (AUDITORIA.md#BUG-06): **achados do mesmo arquivo viram UMA
// correção**. Gerar uma por achado faz cada uma partir do arquivo ORIGINAL —
// a última gravada apaga as anteriores, e a tela diz que todas foram
// corrigidas. Agrupar por arquivo é o que impede isso.
//
// A segunda regra é o encadeamento: um arquivo pode ter mais achados do que
// cabe numa passada. As fatias são encadeadas por `baseCode` — cada uma parte
// do resultado da anterior —, então nada é descartado e nada é reescrito por
// cima.
//
// Mora no NÚCLEO, e não na extensão, porque nada disto é do VS Code: é a mesma
// aritmética que o `BatchFixModal` do painel faz no navegador, e que o terminal
// vai querer no dia em que `starguard fix` receber mais de um id. Lógica pura,
// testável sem editor e sem rede — o `Fixer` entra por parâmetro.
// ============================================================
import type {
  FileChange,
  FixContext,
  FixProposal,
  FixableFinding,
  Fixer,
} from "../contracts";
import { normPath } from "../dedup";

/**
 * Quantos achados entram numa passada de correção.
 *
 * O mesmo valor do painel (`FIX_CHUNK_SIZE` em `lib/validation.ts`): é o teto
 * que o prompt aguenta sem a resposta sair truncada.
 */
export const FIX_CHUNK_SIZE = 60;

export interface FileGroup {
  /** O caminho como o achado o escreveu — é o que a tela mostra. */
  file: string;
  findings: FixableFinding[];
}

/**
 * Agrupa por arquivo, preservando a ordem em que os achados chegaram.
 *
 * A comparação é por caminho NORMALIZADO (`src\a.ts` e `src/A.ts` são o mesmo
 * arquivo no Windows), mas o rótulo exibido é o do primeiro achado do grupo —
 * inventar um caminho canônico faria a tela mostrar um arquivo que ninguém
 * escreveu.
 */
export function groupByFile(findings: readonly FixableFinding[]): FileGroup[] {
  const grupos = new Map<string, FileGroup>();
  for (const f of findings) {
    if (!f.file?.trim()) continue;
    const chave = normPath(f.file);
    const g = grupos.get(chave);
    if (g) g.findings.push(f);
    else grupos.set(chave, { file: f.file, findings: [f] });
  }
  return [...grupos.values()];
}

/** Divide em blocos de no máximo `size`. Nada sobra de fora. */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  if (size < 1) return [[...list]];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Uma proposta para o arquivo inteiro.
 *
 * O primeiro achado da fatia é o alvo; os demais viajam em `alsoFix`, que é
 * como o corretor recebe "e conserte isto também, no mesmo arquivo".
 *
 * O `originalCode` guardado é sempre o da PRIMEIRA vez que o arquivo apareceu.
 * Sem isso, o diff da segunda fatia mostraria como "antes" o resultado da
 * primeira — a pessoa revisaria metade da mudança achando que viu tudo.
 */
export async function proposeForFile(
  fixer: Fixer,
  group: FileGroup,
  ctx: FixContext,
  opts: { chunkSize?: number } = {}
): Promise<FixProposal> {
  const fatias = chunk(group.findings, opts.chunkSize ?? FIX_CHUNK_SIZE);
  const originais = new Map<string, string>();
  const acumulado = new Map<string, FileChange>();
  let ultima: FixProposal | undefined;
  let base = ctx.baseCode;

  for (const fatia of fatias) {
    if (ctx.signal?.aborted) break;
    const [alvo, ...tambem] = fatia;
    if (!alvo) continue;

    const proposta = await fixer.propose(alvo, {
      ...ctx,
      alsoFix: tambem,
      baseCode: base,
    });
    ultima = proposta;

    for (const c of proposta.changes) {
      const k = normPath(c.file);
      if (!originais.has(k)) originais.set(k, c.originalCode);
      // Última gravação por caminho vence: dentro de uma fatia o conteúdo já
      // vem consolidado pelo corretor, e entre fatias a mais nova é a que
      // acumulou as anteriores.
      acumulado.set(k, { ...c, originalCode: originais.get(k)! });
    }

    // A próxima fatia parte do arquivo PRINCIPAL já corrigido. O corretor de
    // agente pode ter tocado em outros arquivos; esses seguem em `acumulado` e
    // não são reenviados — reenviá-los faria a fatia seguinte reescrevê-los a
    // partir de um contexto que ela não tem.
    base = acumulado.get(normPath(proposta.file))?.fixedCode ?? base;
  }

  if (!ultima) {
    throw new Error("Nenhuma fatia foi proposta para este arquivo.");
  }

  const changes = [...acumulado.values()];
  return {
    ...ultima,
    changes,
    // `noChange` do lote é do LOTE: uma fatia que não mudou nada não torna o
    // arquivo intocado se outra mudou. A pergunta que a tela faz é "há o que
    // aplicar?", e a resposta honesta vem da comparação, não da última fatia.
    noChange: changes.every((c) => c.fixedCode === c.originalCode),
  };
}
