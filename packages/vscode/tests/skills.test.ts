// ============================================================
// De onde sai a skill que o analisador lê — AUDITORIA.md#UX-23.
//
// Duas coisas se testam aqui, e as duas doeram na mão:
//
// 1. O painel não tinha ONDE receber um arquivo de skill. A entrada era o
//    editor ativo e nada mais, então um `prompts.md` fechado era impossível de
//    analisar: o cartão apagava com "sem entrada" e a tela não oferecia saída.
// 2. O filtro do editor ativo era `!doc.isUntitled` — e isso aceita qualquer
//    documento, inclusive o painel de SAÍDA da própria extensão e o diff
//    virtual da correção. O resultado saía com cara de análise legítima.
// ============================================================
import { describe, it, expect } from "vitest";
import {
  acrescentar,
  ehArquivoDeVerdade,
  fonteDeSkills,
  nomeDe,
  type DocumentoAberto,
} from "../src/skills";

const arquivo = (caminho: string): DocumentoAberto => ({
  esquema: "file",
  caminho,
  semTitulo: false,
});

describe("o que conta como arquivo de verdade (UX-23)", () => {
  it("um arquivo em disco conta", () => {
    expect(ehArquivoDeVerdade(arquivo("/proj/prompts.md"))).toBe(true);
  });

  it("o canal de SAÍDA da extensão NÃO conta", () => {
    // Foi o caso real: com o painel de saída em foco, o log da própria
    // extensão era analisado como se fosse a skill.
    expect(
      ehArquivoDeVerdade({
        esquema: "output",
        caminho: "extension-output-starbridge.starguard-vscode-#1-StarGuard",
        semTitulo: false,
      })
    ).toBe(false);
  });

  it("o diff virtual da correção NÃO conta", () => {
    expect(
      ehArquivoDeVerdade({ esquema: "starguard-diff", caminho: "x", semTitulo: false })
    ).toBe(false);
  });

  it("a tela de configurações NÃO conta", () => {
    expect(
      ehArquivoDeVerdade({
        esquema: "vscode-userdata",
        caminho: "/User/settings.json",
        semTitulo: false,
      })
    ).toBe(false);
  });

  it("buffer sem título NÃO conta — não há arquivo a nomear", () => {
    expect(ehArquivoDeVerdade({ esquema: "untitled", caminho: "", semTitulo: true })).toBe(
      false
    );
  });

  it("sem editor nenhum, não conta", () => {
    expect(ehArquivoDeVerdade(undefined)).toBe(false);
    expect(ehArquivoDeVerdade(null)).toBe(false);
  });

  it("o github.dev conta — é arquivo, só que remoto", () => {
    expect(
      ehArquivoDeVerdade({ esquema: "vscode-vfs", caminho: "/repo/SKILL.md", semTitulo: false })
    ).toBe(true);
  });
});

describe("a fonte da skill", () => {
  it("o arquivo ESCOLHIDO ganha do editor aberto", () => {
    // Trocar de aba no meio do caminho não pode mudar o que vai ser analisado.
    const f = fonteDeSkills({
      escolhidos: ["/proj/prompts.md"],
      aberto: arquivo("/proj/outro.ts"),
    });
    expect(f).toEqual({ tipo: "escolhidos", caminhos: ["/proj/prompts.md"] });
  });

  it("sem escolha, o editor aberto é o atalho", () => {
    const f = fonteDeSkills({ escolhidos: [], aberto: arquivo("/proj/SKILL.md") });
    expect(f).toEqual({ tipo: "editor", caminho: "/proj/SKILL.md" });
  });

  it("sem escolha e com o canal de saída em foco: NENHUMA", () => {
    const f = fonteDeSkills({
      escolhidos: [],
      aberto: { esquema: "output", caminho: "StarGuard", semTitulo: false },
    });
    expect(f).toEqual({ tipo: "nenhuma" });
  });

  it("sem escolha e sem editor: NENHUMA — o cartão sai do plano com motivo", () => {
    expect(fonteDeSkills({ escolhidos: [] })).toEqual({ tipo: "nenhuma" });
  });

  it("caminho em branco não vira entrada", () => {
    expect(fonteDeSkills({ escolhidos: ["  ", ""] })).toEqual({ tipo: "nenhuma" });
  });

  it("preserva a ordem e devolve cópia — a lista do painel não é o estado", () => {
    const escolhidos = ["/a.md", "/b.md"];
    const f = fonteDeSkills({ escolhidos });
    expect(f).toEqual({ tipo: "escolhidos", caminhos: ["/a.md", "/b.md"] });
    if (f.tipo === "escolhidos") f.caminhos.push("/c.md");
    expect(escolhidos).toEqual(["/a.md", "/b.md"]);
  });
});

describe("acrescentar arquivos", () => {
  it("não repete o que já está na lista", () => {
    expect(acrescentar(["/a.md"], ["/a.md", "/b.md"])).toEqual(["/a.md", "/b.md"]);
  });

  it("nem dentro da mesma escolha", () => {
    expect(acrescentar([], ["/a.md", "/a.md"])).toEqual(["/a.md"]);
  });

  it("preserva a ordem de escolha", () => {
    expect(acrescentar(["/z.md"], ["/a.md"])).toEqual(["/z.md", "/a.md"]);
  });
});

describe("nome exibido", () => {
  it("corta o caminho do Windows", () => {
    expect(nomeDe("C:\\proj\\skills\\prompts.md")).toBe("prompts.md");
  });

  it("corta o caminho POSIX", () => {
    expect(nomeDe("/home/x/prompts.md")).toBe("prompts.md");
  });

  it("caminho sem separador continua inteiro", () => {
    expect(nomeDe("prompts.md")).toBe("prompts.md");
  });
});
