// ============================================================
// O renderizador do terminal — AUDITORIA.md#ARQ-13.
//
// A regra sob teste é "quando NÃO desenhar". Um log de CI cheio de `\x1b[2K` é
// ilegível, e um `--json` com código de cor no meio deixa de ser JSON. Como o
// vitest roda sem TTY, este arquivo testa exatamente o caminho que o CI usa.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BlocoVivo, c, isInteractive, larguraVisivel, tabela, trunca } from "../src/tty";

const TEM_ANSI = /\x1b\[/;

describe("detecção de terminal", () => {
  it("no vitest (sem TTY) a interface fica desligada", () => {
    expect(isInteractive()).toBe(false);
  });
});

describe("cores", () => {
  it("NÃO emite código de escape quando não há terminal", () => {
    // É o que impede `--json` de sair com cor no meio e `--sarif` de virar um
    // arquivo que nenhum parser aceita.
    expect(TEM_ANSI.test(c.red("erro"))).toBe(false);
    expect(c.red("erro")).toBe("erro");
    expect(c.bold(c.green("ok"))).toBe("ok");
  });
});

describe("BlocoVivo sem TTY", () => {
  let escrito: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    escrito = [];
    spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      escrito.push(String(chunk));
      return true;
    });
  });
  afterEach(() => spy.mockRestore());

  it("não emite escape nenhum", () => {
    const b = new BlocoVivo();
    b.render("linha um\nlinha dois", ["linha um", "linha dois"]);
    expect(escrito.some((s) => TEM_ANSI.test(s))).toBe(false);
  });

  it("imprime SÓ as linhas em estado final", () => {
    const b = new BlocoVivo();
    // "rodando" é estado de tela; num log sequencial ele é ruído.
    b.render("cabeçalho\n  ⠋ rodando\n  ✔ pronto", ["  ✔ pronto"]);
    expect(escrito.join("")).toBe("  ✔ pronto\n");
  });

  it("não repete linha já impressa", () => {
    const b = new BlocoVivo();
    b.render("x", ["  ✔ sca"]);
    b.render("x", ["  ✔ sca", "  ✔ sast"]);
    expect(escrito.join("")).toBe("  ✔ sca\n  ✔ sast\n");
  });

  it("sem linhas finais, não escreve nada", () => {
    const b = new BlocoVivo();
    b.render("  ⠋ rodando", []);
    expect(escrito).toEqual([]);
  });
});

describe("largura e truncamento", () => {
  it("larguraVisivel ignora os códigos de escape", () => {
    // Sem isto, uma coluna colorida ficaria desalinhada de todas as outras.
    expect(larguraVisivel("\x1b[31mabc\x1b[0m")).toBe(3);
  });

  it("trunca com reticências e respeita o limite", () => {
    expect(trunca("abcdefgh", 4)).toBe("abc…");
    expect(trunca("abc", 10)).toBe("abc");
  });
});

describe("tabela", () => {
  it("cada coluna ocupa o que o conteúdo pede, NÃO o teto declarado", () => {
    // Uma coluna de caminhos curtos não pode reservar 40 posições e espremer a
    // descrição do problema, que é o texto que alguém realmente lê. O teto de
    // 40 é limite, não reserva.
    const linhas = tabela(
      [
        ["SEV", "ARQUIVO", "PROBLEMA"],
        ["high", "package.json", "postcss 8.4.31 → 8.5.12"],
      ],
      [10, 40, null],
      120
    );
    // "ARQUIVO" tem 7 e "package.json" tem 12 → a coluna vale 12, não 40.
    expect(linhas[1]).toBe("high  package.json  postcss 8.4.31 → 8.5.12");
    // E o texto do problema chega inteiro, sem reticências.
    expect(linhas[1]).not.toContain("…");
  });

  it("respeita o teto quando o conteúdo é maior", () => {
    const [linha] = tabela([["um caminho bem comprido demais"]], [10], 80);
    expect(larguraVisivel(linha!)).toBeLessThanOrEqual(10);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(tabela([], [10], 80)).toEqual([]);
  });
});
