// ============================================================
// A interface do terminal — ANSI escrito à mão, sem dependência.
//
// Por que sem biblioteca: isto é uma ferramenta de segurança, e cada pacote de
// terceiro na árvore é superfície de supply chain que ela mesma deveria estar
// vigiando. O que uma lib de TUI entregaria aqui — cursor, cores, redesenho —
// cabe neste arquivo. A mesma decisão que o projeto já tomou no i18n.
//
// A regra que mais importa não é como desenhar, é QUANDO NÃO desenhar: sem
// TTY (pipe, redirecionamento, CI) nada de escape, nada de redesenho, nada de
// spinner. Um log de CI cheio de `\x1b[2K` é ilegível, e um `--json` com
// código de cor no meio não é JSON.
// ============================================================

const ESC = "\x1b[";

/**
 * Vale desenhar interface?
 *
 * `stdout.isTTY` responde "há um terminal do outro lado". `NO_COLOR` e `CI`
 * são convenções que muita ferramenta respeita e custa nada honrar.
 */
export function isInteractive(): boolean {
  if (process.env.NO_COLOR || process.env.CI) return false;
  return !!process.stdout.isTTY;
}

const cor = isInteractive();

function tinge(codigo: string, s: string): string {
  return cor ? `${ESC}${codigo}m${s}${ESC}0m` : s;
}

export const c = {
  bold: (s: string) => tinge("1", s),
  dim: (s: string) => tinge("2", s),
  red: (s: string) => tinge("31", s),
  green: (s: string) => tinge("32", s),
  yellow: (s: string) => tinge("33", s),
  blue: (s: string) => tinge("34", s),
  magenta: (s: string) => tinge("35", s),
  cyan: (s: string) => tinge("36", s),
  gray: (s: string) => tinge("90", s),
};

/** Largura do texto ignorando os códigos de escape, para alinhar colunas. */
export function larguraVisivel(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function preenche(s: string, largura: number): string {
  const falta = largura - larguraVisivel(s);
  return falta > 0 ? s + " ".repeat(falta) : s;
}

export function trunca(s: string, largura: number): string {
  if (larguraVisivel(s) <= largura) return s;
  return s.slice(0, Math.max(0, largura - 1)) + "…";
}

/**
 * Bloco que se redesenha no lugar.
 *
 * Guarda quantas linhas escreveu para subir o cursor exatamente isso na
 * próxima vez. Sem TTY, `render` vira "escreve a linha nova e segue" — o
 * histórico do CI fica sequencial, que é o que se quer ler depois.
 */
export class BlocoVivo {
  private linhas = 0;
  private ultimo = "";

  /**
   * @param texto      o bloco completo, como ficaria na tela
   * @param definitivo linhas em estado FINAL; sem TTY, só elas são impressas
   */
  render(texto: string, definitivo?: string[]): void {
    if (!isInteractive()) {
      // Sem terminal não há redesenho, então imprimir cada estado
      // intermediário deixaria o log com três linhas por analisador
      // ("aguardando", "rodando", "pronto") — ruído puro no histórico do CI.
      // Só o desfecho é impresso, uma vez cada.
      const jaVistas = new Set(this.ultimo.split("\n"));
      for (const l of definitivo ?? []) {
        if (l.trim() && !jaVistas.has(l)) {
          process.stdout.write(l + "\n");
          jaVistas.add(l);
        }
      }
      this.ultimo = [...jaVistas].join("\n");
      return;
    }

    if (this.linhas > 0) {
      process.stdout.write(`${ESC}${this.linhas}A`); // sobe
      process.stdout.write(`${ESC}0J`); // apaga daqui para baixo
    }
    process.stdout.write(texto.endsWith("\n") ? texto : texto + "\n");
    this.linhas = texto.split("\n").length + (texto.endsWith("\n") ? 0 : 1) - 1;
    this.ultimo = texto;
  }

  /** Encerra o bloco: o próximo `render` começa do zero, abaixo do que ficou. */
  fecha(): void {
    this.linhas = 0;
  }
}

const QUADROS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Quadro do spinner para o instante `tick`. Sem TTY, um traço fixo. */
export function spinner(tick: number): string {
  return isInteractive() ? QUADROS[tick % QUADROS.length]! : "-";
}

export function esconderCursor(): void {
  if (isInteractive()) process.stdout.write(`${ESC}?25l`);
}

export function mostrarCursor(): void {
  if (isInteractive()) process.stdout.write(`${ESC}?25h`);
}

/**
 * Tabela alinhada por coluna.
 *
 * `larguras` aceita `null` para "o que sobrar" — usado na coluna de título,
 * que é a que deve encolher quando o terminal é estreito.
 */
export function tabela(
  linhas: string[][],
  larguras: (number | null)[],
  larguraTotal = process.stdout.columns || 120
): string[] {
  if (!linhas.length) return [];

  // Cada coluna ocupa o que o CONTEÚDO dela pede, até o teto declarado. Sem
  // isto, uma coluna de caminhos curtos (`package.json`) reservava 40 colunas
  // e espremia a descrição do problema em vinte caracteres — que é o único
  // texto ali que alguém precisa ler.
  const naturais = larguras.map((_, i) =>
    Math.max(...linhas.map((l) => larguraVisivel(l[i] ?? "")))
  );
  const resolvidas = larguras.map((teto, i) =>
    teto === null ? null : Math.min(teto, naturais[i]!)
  );

  const fixas = resolvidas.reduce<number>((a, w) => a + (w ?? 0), 0);
  const flex = resolvidas.filter((w) => w === null).length;
  const sobra = Math.max(20, larguraTotal - fixas - larguras.length * 2);
  const porFlex = flex ? Math.floor(sobra / flex) : 0;

  return linhas.map((cols) =>
    cols
      .map((v, i) => {
        const w = resolvidas[i] ?? porFlex;
        return preenche(trunca(v, w), w);
      })
      .join("  ")
      .trimEnd()
  );
}
