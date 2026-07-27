// ============================================================
// Diff por linhas, sem dependência externa.
//
// A tela mostrava o arquivo corrigido INTEIRO num <pre>: para revisar uma
// correção de 2 linhas num arquivo de 400, o usuário lia 400 linhas e
// adivinhava o que mudou. Ver AUDITORIA.md#UX-02.
// ============================================================

export type DiffType = "eq" | "add" | "del";

export interface DiffLine {
  type: DiffType;
  text: string;
  /** Número da linha no arquivo original (1-based), quando existe. */
  aNum?: number;
  /** Número da linha no arquivo corrigido (1-based), quando existe. */
  bNum?: number;
}

/**
 * Acima disto não vale a pena montar a tabela de LCS (memória O(n·m)). Como
 * cortamos prefixo e sufixo iguais antes, só um arquivo reescrito de ponta a
 * ponta chega perto — e aí o diff linha a linha não ajudaria mesmo.
 */
const MAX_LCS = 1200;

function splitLines(s: string): string[] {
  return s.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(originalRaw: string, fixedRaw: string): DiffLine[] {
  const a = splitLines(originalRaw);
  const b = splitLines(fixedRaw);

  // Prefixo e sufixo iguais saem fora primeiro. Uma correção cirúrgica reduz
  // o problema a pouquíssimas linhas — é o que torna o LCS viável.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) {
    out.push({ type: "eq", text: a[i]!, aNum: i + 1, bNum: i + 1 });
  }

  if (midA.length > MAX_LCS || midB.length > MAX_LCS) {
    // Bloco grande demais: reporta como remoção + inserção inteiras.
    midA.forEach((t, i) => out.push({ type: "del", text: t, aNum: start + i + 1 }));
    midB.forEach((t, i) => out.push({ type: "add", text: t, bNum: start + i + 1 }));
  } else {
    // LCS clássico por programação dinâmica.
    const n = midA.length;
    const m = midB.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () =>
      new Array<number>(m + 1).fill(0)
    );
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] =
          midA[i] === midB[j]
            ? dp[i + 1]![j + 1]! + 1
            : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({
          type: "eq",
          text: midA[i]!,
          aNum: start + i + 1,
          bNum: start + j + 1,
        });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        out.push({ type: "del", text: midA[i]!, aNum: start + i + 1 });
        i++;
      } else {
        out.push({ type: "add", text: midB[j]!, bNum: start + j + 1 });
        j++;
      }
    }
    while (i < n) {
      out.push({ type: "del", text: midA[i]!, aNum: start + i + 1 });
      i++;
    }
    while (j < m) {
      out.push({ type: "add", text: midB[j]!, bNum: start + j + 1 });
      j++;
    }
  }

  for (let k = 0; k < a.length - endA; k++) {
    out.push({
      type: "eq",
      text: a[endA + k]!,
      aNum: endA + k + 1,
      bNum: endB + k + 1,
    });
  }

  return out;
}

export interface DiffChunk {
  /** Trecho de contexto colapsado ("… 120 linhas inalteradas"). */
  collapsed?: number;
  lines: DiffLine[];
}

/**
 * Agrupa o diff em blocos, colapsando regiões inalteradas maiores que
 * `context * 2`. É o que faz caber na tela.
 */
export function toChunks(lines: DiffLine[], context = 3): DiffChunk[] {
  const changed = lines
    .map((l, i) => (l.type === "eq" ? -1 : i))
    .filter((i) => i >= 0);
  if (!changed.length) return [{ lines }];

  const keep = new Set<number>();
  for (const idx of changed) {
    for (let k = idx - context; k <= idx + context; k++) {
      if (k >= 0 && k < lines.length) keep.add(k);
    }
  }

  const chunks: DiffChunk[] = [];
  let current: DiffLine[] = [];
  let hidden = 0;

  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (hidden > 0) {
        if (current.length) chunks.push({ lines: current });
        chunks.push({ collapsed: hidden, lines: [] });
        current = [];
        hidden = 0;
      }
      current.push(lines[i]!);
    } else {
      hidden++;
    }
  }
  if (current.length) chunks.push({ lines: current });
  if (hidden > 0) chunks.push({ collapsed: hidden, lines: [] });

  return chunks;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "del").length,
  };
}
