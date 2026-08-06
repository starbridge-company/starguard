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
    "nenhumSelecionado", "privacidade", "skills", "skillsAjuda", "skillsVazio",
    "skillsAdicionar", "skillsRemover", "skillsDoEditor", "marcarTudo",
    "desmarcar", "corrigirSelecionados", "correcoes", "correcoesAjuda",
    "gerandoCorrecoes", "estadoGerando", "estadoPronta", "estadoAplicada",
    "estadoSemMudanca", "estadoErro", "estadoCancelada", "verDiff", "aplicar",
    "aplicarTudo", "descartar", "umAchado", "nAchados", "maisArquivos",
    "nadaMarcado", "filtrarTudo", "filtrarAjuda", "degradado", "requisitos",
    "requisitosAjuda", "pr", "prHint", "prBase", "prAbrindo", "prVer", "prAberto",
    "progresso", "progressoAguarde",
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

describe("há ONDE colocar a skill (UX-23)", () => {
  it("a página traz o botão de escolher arquivo", () => {
    // O furo: a única entrada era o editor ativo, e o painel não tinha campo
    // nenhum — quem quisesse analisar um `prompts.md` fechado não tinha onde
    // clicar. O botão é a entrada que faltava.
    expect(pagina()).toContain('data-acao="escolherSkills"');
  });

  it("o rótulo do bloco sai do dicionário, não do código", () => {
    const html = htmlDoPainel({
      nonce: "n",
      cspSource: "x",
      textos: { ...TEXTOS, skills: "Skills y prompts" },
    });
    expect(html).toContain("Skills y prompts");
  });

  it("cada arquivo escolhido pode ser removido", () => {
    expect(pagina()).toContain("data-tira-skill");
  });
});

describe("correção em lote (UX-24)", () => {
  it("cada achado corrigível tem caixa de seleção", () => {
    expect(pagina()).toContain("data-marca");
  });

  it("existe o botão que corrige o que está marcado", () => {
    expect(pagina()).toContain('data-acao="corrigirLote"');
  });

  it("a proposta pronta tem ver-diff e aplicar, e o lote tem aplicar-tudo", () => {
    const html = pagina();
    expect(html).toContain("data-ver=");
    expect(html).toContain("data-aplicar=");
    expect(html).toContain('data-acao="aplicarTudo"');
  });

  it("dá para descartar sem gravar nada", () => {
    expect(pagina()).toContain("descartarCorrecoes");
  });

  it("o placar filtra por gravidade", () => {
    expect(pagina()).toContain("data-sev");
  });
});

describe("o botão de analisar não fica preso (UX-24)", () => {
  it("o evento de PROGRESSO não decide mais se a execução acabou", () => {
    // Teste por texto porque é o formato do arquivo — a página é uma string.
    // O que ele trava é o bug exato: `estado.rodando = m.rodando` fazia o
    // último evento de progresso (que sempre dizia "rodando") congelar o
    // botão em "Analisando…" para sempre. Quem sabe se acabou é a extensão,
    // que manda o estado inteiro no fim.
    expect(pagina()).not.toContain("estado.rodando = m.rodando");
  });

  it("o estado de execução chega pelo estado completo", () => {
    expect(pagina()).toContain("rodando: false");
  });
});

describe("o cartão não carrega mais os selos de IA e de servidor", () => {
  it("nenhum selo é desenhado no cartão", () => {
    // Duas etiquetas por cartão dizendo de ONDE vem a execução, num lugar em
    // que a pergunta é "isto serve para mim?". O que importa sobre custo e
    // velocidade está no tooltip do cartão, em "Quando usar".
    const html = pagina();
    expect(html).not.toContain('class="selo');
    expect(html).not.toContain('class="selos"');
  });

  it("a explicação de cada analisador continua chegando pelo tooltip", () => {
    // O que substituiu os selos. Se isto sair, o cartão fica com uma linha de
    // subtítulo e nada mais.
    expect(pagina()).toContain("a.sobre");
  });
});

describe("Pull Request a partir do painel", () => {
  it("existe o botão que abre UM PR com o que está pronto", () => {
    expect(pagina()).toContain('data-acao="abrirPr"');
  });

  it("entram no PR tanto as prontas quanto as JÁ APLICADAS", () => {
    // Aplicar grava no disco de quem clicou; o PR leva a mesma mudança para o
    // repositório. São dois destinos, não duas decisões excludentes — quem já
    // aplicou e depois quer o PR não deveria ter de gerar tudo de novo.
    expect(pagina()).toMatch(/estado === 'pronta' \|\| c\.estado === 'aplicada'/);
  });

  it("o aviso da branch aparece ANTES do botão, não depois", () => {
    // O PR parte da branch padrão do repositório REMOTO. Quem tem trabalho
    // local não enviado precisa saber disso antes de clicar; depois vira
    // relato de estrago.
    const html = pagina();
    expect(html.indexOf("prBase")).toBeGreaterThan(-1);
    expect(html.indexOf("prBase")).toBeLessThan(html.indexOf('data-acao="abrirPr"'));
  });

  it("o botão desabilita enquanto o PR está sendo aberto", () => {
    // Dois cliques abririam dois PRs no mesmo repositório.
    expect(pagina()).toContain("pr.abrindo ?");
  });

  it("com o PR aberto, a tela oferece o link em vez do botão", () => {
    expect(pagina()).toContain('data-acao="verPr"');
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

// ============================================================
// A barra de progresso — pedida depois de uma análise de mais de um minuto
// terminar sem que a tela dissesse nada sobre o andamento.
// ============================================================
describe("barra de progresso da análise", () => {
  it("existe e é DETERMINADA", () => {
    // O plano sabe quantos analisadores vão rodar antes de o primeiro começar.
    // Uma listra indeterminada num trabalho que passa de um minuto só prova
    // que o processo não morreu — não informa nada.
    const html = pagina();
    expect(html).toContain('class="progresso"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("aria-valuenow=");
  });

  it("some quando não há execução em curso", () => {
    // Barra parada em 100% depois que acabou é ruído.
    expect(pagina()).toContain("if (!estado.rodando || !p || !p.total) return ''");
  });

  it("o cronômetro NÃO redesenha a página inteira", () => {
    // Redesenhar a cada segundo apagaria o que a pessoa estivesse digitando na
    // descrição do sistema.
    const html = pagina();
    expect(html).toContain("el.textContent = el.dataset.base");
    expect(html).not.toMatch(/setInterval\(desenhar/);
  });

  it("o intervalo é encerrado quando a barra sai", () => {
    // Um `setInterval` órfão continua acordando o webview para sempre.
    expect(pagina()).toContain("clearInterval(relogio)");
  });

  it("fica logo abaixo do botão de analisar", () => {
    // É onde o olho já está depois do clique — e não no fim da página, onde
    // ninguém rolaria para procurar.
    const html = pagina();
    expect(html.indexOf("barraDeProgresso()")).toBeGreaterThan(-1);
    expect(html.indexOf("html += barraDeProgresso();")).toBeGreaterThan(
      html.indexOf("id=\"rodar\"")
    );
  });
});
