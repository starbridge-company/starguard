// ============================================================
// O scan no servidor — AUDITORIA.md#ARQ-14.
//
// A rota `/api/scan` é o ponto onde código de OUTRA PESSOA entra na nossa
// máquina e é escrito no nosso disco. Isso faz do caminho de cada arquivo
// entrada hostil: um `../` aceito não é um bug de exibição, é escrita
// arbitrária no servidor.
//
// Por isso este arquivo é quase todo caminho negativo. O caso feliz tem duas
// asserções; o resto é o que precisa ser RECUSADO.
// ============================================================
import { describe, it, expect } from "vitest";
import { caminhoSeguro } from "@/app/api/scan/route";

describe("caminhos que o servidor aceita", () => {
  it("um caminho relativo comum", () => {
    expect(caminhoSeguro("src/app/page.tsx")).toBe("src/app/page.tsx");
  });

  it("a barra invertida do Windows vira barra normal", () => {
    // Quem manda é a extensão rodando em Windows; o `path` do achado volta
    // para o cliente e precisa casar com o que ele conhece.
    expect(caminhoSeguro("src\\lib\\db.ts")).toBe("src/lib/db.ts");
  });

  it("um arquivo na raiz", () => {
    expect(caminhoSeguro("package.json")).toBe("package.json");
  });
});

describe("caminhos que o servidor RECUSA", () => {
  it("escapar da raiz com `..`", () => {
    // O caso que importa: sem isto, um cliente autenticado sobrescreve
    // arquivos fora do diretório temporário.
    expect(caminhoSeguro("../../etc/passwd")).toBeNull();
  });

  it("`..` no meio do caminho", () => {
    expect(caminhoSeguro("src/../../fora.txt")).toBeNull();
  });

  it("`..` disfarçado com barra invertida", () => {
    expect(caminhoSeguro("src\\..\\..\\fora.txt")).toBeNull();
  });

  it("caminho absoluto POSIX", () => {
    expect(caminhoSeguro("/etc/passwd")).toBeNull();
  });

  it("caminho absoluto do Windows", () => {
    expect(caminhoSeguro("C:\\Windows\\System32\\drivers\\etc\\hosts")).toBeNull();
  });

  it("caminho com byte nulo", () => {
    // O byte nulo trunca a string em chamadas de sistema de alguns runtimes:
    // `a.txt\u0000.png` vira `a.txt`.
    expect(caminhoSeguro("arquivo.txt\u0000.png")).toBeNull();
  });

  it("caminho vazio ou só ponto", () => {
    expect(caminhoSeguro("")).toBeNull();
    expect(caminhoSeguro(".")).toBeNull();
  });

  it("caminho absurdamente longo", () => {
    expect(caminhoSeguro("a/".repeat(300) + "x.ts")).toBeNull();
  });
});
