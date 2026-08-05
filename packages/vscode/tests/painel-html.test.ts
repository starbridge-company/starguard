// ============================================================
// O painel é uma PÁGINA WEB — AUDITORIA.md#UX-20.
//
// Isso muda a natureza do risco. A árvore que o painel substituiu renderizava
// texto; um webview interpreta marcação. E o conteúdo que ele exibe vem todo
// de fora: título de regra do Opengrep, nome de pacote do Trivy, descrição
// escrita por um modelo, caminho de arquivo de um repositório qualquer.
//
// Um achado cujo título fosse `<img src=x onerror=…>` executaria script dentro
// do editor de quem instalou a extensão. As duas defesas — escapar todo texto
// dinâmico e uma CSP com nonce — são o que este arquivo trava.
// ============================================================
import { describe, it, expect } from "vitest";
import { esc, htmlDoPainel, jsonSeguroEmScript, type TextosDoPainel } from "../src/painel-html";

const TEXTOS = Object.fromEntries(
  [
    "titulo", "entrar", "entrarSub", "solicitar", "analisadores", "selecionarTudo",
    "limpar", "analisar", "analisando", "cancelar", "descreverSistema",
    "descricaoAjuda", "descricaoVazia", "resultado", "semAchados", "aindaNaoRodou",
    "usaIa", "noServidor", "indisponivel", "corrigir", "diagnostico", "sair",
    "nenhumSelecionado", "privacidade",
  ].map((k) => [k, k])
) as unknown as TextosDoPainel;

const pagina = () =>
  htmlDoPainel({ nonce: "N0NC3", cspSource: "vscode-webview://x", textos: TEXTOS });

describe("escapa o que vem de fora", () => {
  it("neutraliza uma tag", () => {
    expect(esc("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("neutraliza o atributo de evento", () => {
    // O vetor real num painel de achados: o título fecha o atributo e abre
    // um `onerror`.
    expect(esc('" onerror="fetch(1)')).toBe("&quot; onerror=&quot;fetch(1)");
  });

  it("escapa a aspa simples — atributo pode usar as duas", () => {
    expect(esc("' onclick='x")).toBe("&#39; onclick=&#39;x");
  });

  it("escapa o `&` ANTES do resto, sem duplicar", () => {
    // Ordem errada produz `&amp;lt;`, que aparece literalmente na tela.
    expect(esc("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("a política de segurança da página", () => {
  it("declara CSP com `default-src 'none'`", () => {
    expect(pagina()).toContain("default-src 'none'");
  });

  it("o script só roda com o nonce desta renderização", () => {
    // Sem nonce, um `<script>` injetado por conteúdo executaria.
    expect(pagina()).toContain("script-src 'nonce-N0NC3'");
    expect(pagina()).toContain('<script nonce="N0NC3">');
  });

  it("não permite `unsafe-eval` nem script de qualquer origem", () => {
    const html = pagina();
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toMatch(/script-src[^;]*\*/);
  });

  it("não carrega nada de rede — a página é autossuficiente", () => {
    const html = pagina();
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });
});

describe("a página pertence ao tema do editor", () => {
  it("usa variáveis do VS Code, não cor fixa", () => {
    expect(pagina()).toContain("var(--vscode-foreground)");
  });

  it("respeita quem pediu menos animação", () => {
    // Um spinner girando sem parar é o caso clássico de gatilho vestibular.
    expect(pagina()).toContain("prefers-reduced-motion");
  });
});

describe("o JSON embutido não escapa do bloco `<script>`", () => {
  it("`<` vira \u003c — `JSON.stringify` sozinho NÃO faz isso", () => {
    // Foi o furo: `JSON.stringify("a</script>")` devolve a sequência intacta,
    // e o parser de HTML fecha a tag ali, jogando o resto como marcação.
    expect(jsonSeguroEmScript("a</script>b")).not.toContain("</script>");
    expect(jsonSeguroEmScript("a</script>b")).toContain("\\u003c");
  });

  it("os separadores de linha do Unicode também", () => {
    // U+2028 e U+2029 são quebra de linha para o JavaScript e não para o
    // JSON: passam pelo `stringify` e quebram o literal.
    expect(jsonSeguroEmScript("a\u2028b")).toContain("\\u2028");
  });

  it("continua sendo JSON válido depois do escape", () => {
    const v = { a: "<b>", c: "d</script>" };
    expect(JSON.parse(jsonSeguroEmScript(v))).toEqual(v);
  });

  it("um rótulo com `</script>` não fecha o bloco da página", () => {
    const html = htmlDoPainel({
      nonce: "n",
      cspSource: "x",
      textos: { ...TEXTOS, analisar: "a</script><img onerror=1>" },
    });
    // Só deve existir UM fechamento de script na página.
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });
});
