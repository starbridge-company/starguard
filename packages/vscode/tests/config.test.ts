// ============================================================
// Identidade da extensão publicada — AUDITORIA.md#SEC-14.
//
// Três valores precisam casar entre arquivos diferentes, e quando divergem o
// sintoma é sempre o mesmo: o login abre o navegador, a pessoa autoriza, e o
// retorno **nunca chega** — sem erro visível em lugar nenhum.
//
//   package.json (publisher + name)  →  o id real da extensão publicada
//   src/auth.ts (EXTENSION_ID)       →  monta o `vscode://<id>/auth`
//   lib/oauth/clients.ts             →  a allowlist que o servidor confere
//
// O id é PERMANENTE depois de publicado. Este arquivo existe para que um
// esquecimento vire falha de suíte, e não um incidente que só aparece com a
// extensão já na Marketplace.
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { redirectUriPermitido } from "@/lib/oauth/clients";

const aqui = dirname(fileURLToPath(import.meta.url));
const manifesto = JSON.parse(
  readFileSync(join(aqui, "..", "package.json"), "utf8")
) as {
  publisher: string;
  name: string;
  version: string;
  scripts: Record<string, string>;
  contributes: Record<string, unknown>;
};
const lock = JSON.parse(
  readFileSync(join(aqui, "..", "..", "..", "package-lock.json"), "utf8")
) as { packages: Record<string, { version?: string }> };
const authTs = readFileSync(join(aqui, "..", "src", "auth.ts"), "utf8");
const configTs = readFileSync(join(aqui, "..", "src", "config.ts"), "utf8");

const ID_REAL = `${manifesto.publisher}.${manifesto.name}`;

describe("o id da extensão bate nos três lugares", () => {
  it("`auth.ts` usa o mesmo id do manifesto", () => {
    const noCodigo = authTs.match(/EXTENSION_ID = "([^"]+)"/)?.[1];
    expect(noCodigo).toBe(ID_REAL);
  });

  it("a allowlist do SERVIDOR aceita o redirect deste id", () => {
    // Se divergir, o servidor responde "redirect_uri não permitido" e o login
    // morre calado no navegador.
    expect(redirectUriPermitido("starguard-vscode", `vscode://${ID_REAL}/auth`)).toBe(true);
  });

  it("a allowlist RECUSA o id antigo — a troca foi completa", () => {
    expect(
      redirectUriPermitido("starguard-vscode", "vscode://starguard.starguard-vscode/auth")
    ).toBe(false);
  });

  it("funciona nos editores derivados, com o mesmo id", () => {
    for (const esquema of ["vscode-insiders", "cursor", "vscodium", "windsurf"]) {
      expect(
        redirectUriPermitido("starguard-vscode", `${esquema}://${ID_REAL}/auth`),
        esquema
      ).toBe(true);
    }
  });
});

describe("o servidor bate entre o código e o manifesto", () => {
  const props = (
    manifesto.contributes as { configuration: { properties: Record<string, { default?: string }> } }
  ).configuration.properties;

  it("`SERVIDOR_PADRAO` é o mesmo `default` de `starguard.server`", () => {
    // O servidor é temporário e vai mudar. Se os dois saírem de sincronia, a
    // extensão nova aponta para um lugar e a configuração de quem já a tem
    // aponta para outro.
    const noCodigo = configTs.match(/SERVIDOR_PADRAO = "([^"]+)"/)?.[1];
    expect(noCodigo).toBe(props["starguard.server"]!.default);
  });

  it("é HTTPS — o token de acesso viaja por aí", () => {
    expect(props["starguard.server"]!.default).toMatch(/^https:\/\//);
  });

  it("não tem barra no fim", () => {
    // A URL é concatenada com `/api/...`; barra dupla quebra rota em alguns
    // servidores e é o tipo de erro que só aparece em produção.
    expect(props["starguard.server"]!.default).not.toMatch(/\/$/);
  });
});

describe("a extensão tem lugar próprio na barra lateral", () => {
  // Nasceu de um caso REAL: a v0.1.0 declarava `views: { explorer: [...] }`, o
  // que põe a view como uma SEÇÃO dentro do Explorer, abaixo de Outline e
  // Timeline. Não há ícone na barra de atividades, e quem instala procura ali
  // — então a extensão simplesmente "não aparece", sem erro nenhum.
  const c = manifesto.contributes as {
    viewsContainers?: { activitybar?: Array<{ id: string; icon: string }> };
    views: Record<string, Array<{ id: string; type?: string }>>;
  };

  it("tem contêiner PRÓPRIO na barra de atividades", () => {
    const cont = c.viewsContainers?.activitybar?.[0];
    expect(cont).toBeDefined();
    expect(cont!.id).toBe("starguard");
  });

  it("o ícone do contêiner é SVG — o VS Code aplica máscara e tema", () => {
    expect(c.viewsContainers!.activitybar![0]!.icon).toMatch(/\.svg$/);
  });

  it("a view vive no contêiner próprio, NÃO no explorer", () => {
    expect(c.views.explorer).toBeUndefined();
    expect(c.views.starguard?.[0]?.id).toBe("starguard.painel");
  });

  it("é um WEBVIEW — o painel desenha a própria interface", () => {
    // Sem `type: "webview"` o VS Code espera um `TreeDataProvider` e a view
    // fica permanentemente vazia, sem erro nenhum no log.
    expect(c.views.starguard?.[0]?.type).toBe("webview");
  });

  it("ativa na inicialização — o painel tem de estar pronto ao primeiro clique", () => {
    const eventos = (manifesto as unknown as { activationEvents: string[] }).activationEvents;
    expect(eventos).toContain("onStartupFinished");
    // `onUri` é o retorno do navegador no login: sem ele o código de
    // autorização chega e ninguém está escutando.
    expect(eventos).toContain("onUri");
  });
});

describe("o portão de login é desenhado pelo painel", () => {
  // O `viewsWelcome` do VS Code só existe para árvore. Num webview quem
  // decide o que aparece é a própria página — e por isso a tela de entrada
  // passou a ser responsabilidade do `painel-html.ts`.
  const fonteHtml = readFileSync(join(aqui, "..", "src", "painel-html.ts"), "utf8");

  it("a tela de entrada existe na página", () => {
    expect(fonteHtml).toContain("function porta()");
    expect(fonteHtml).toContain('data-acao="entrar"');
  });

  it("oferece também SOLICITAR ACESSO — quem não tem conta precisa de saída", () => {
    // Sem isto, a via de contato de quem instalou da Marketplace vira a aba
    // de avaliações.
    expect(fonteHtml).toContain('data-acao="solicitar"');
  });

  it("o painel só desenha os analisadores com sessão", () => {
    const fontePainel = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");
    expect(fontePainel).toContain("analisadores: sessao ? cartoes() : []");
  });
});

describe("nada precisa ser instalado na máquina de quem usa", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");

  it("o transporte de SCAN é ligado junto com o de IA", () => {
    // É isto que faz `sast` e `sca` rodarem no servidor. Sem esta linha a
    // extensão volta a exigir `opengrep` e `trivy` no PATH de quem instalou.
    expect(fonte).toContain("setScanTransport({ kind: \"remote\"");
  });

  // O cartão ANUNCIAVA "servidor" e "IA" em dois selos. Saíram: eram
  // informação de bastidor num lugar onde a pergunta é "isto serve para mim?",
  // e o que importa sobre custo e velocidade está no tooltip do cartão, em
  // "Quando usar". O que NÃO pode sair é o transporte em si — este arquivo
  // continua cobrindo isso nos outros casos.
  it("o cartão não carrega mais os selos de IA e de servidor", () => {
    const fonteHtmlAqui = readFileSync(join(aqui, "..", "src", "painel-html.ts"), "utf8");
    expect(fonte).not.toContain("panel.usesAi");
    expect(fonte).not.toContain("panel.onServer");
    expect(fonteHtmlAqui).not.toContain('class="selo');
  });

  it("a disponibilidade é recalculada com o transporte já ligado", () => {
    // `probe()` de sast/sca responde `ok` no modo remoto. Sem ligar o
    // transporte ANTES de montar o plano, o painel anunciaria "instale o
    // trivy" para quem escolheu não instalar nada.
    expect(fonte).toMatch(
      /await ligarIaSeJaConsentiu\(\);[\s\S]*?ultimoPlano = await montarPlano/
    );
  });
});

describe("a chave de IA é da Starbridge — não há chave local a configurar", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");

  it("não há comando de definir chave no manifesto", () => {
    const cmds = (
      manifesto.contributes as { commands: Array<{ command: string }> }
    ).commands.map((c) => c.command);
    expect(cmds).not.toContain("starguard.setApiKey");
  });

  it("não há configuração de chave", () => {
    const props = (
      manifesto.contributes as { configuration: { properties: Record<string, unknown> } }
    ).configuration.properties;
    expect(Object.keys(props).some((k) => /apikey/i.test(k))).toBe(false);
  });

  it("a extensão não GRAVA chave no chaveiro", () => {
    expect(fonte).not.toMatch(/secrets\.store\(\s*"starguard\.apiKey"/);
  });

  it("uma chave de versão anterior é APAGADA na ativação", () => {
    // Sem comando para ver ou trocar, ela viraria um segredo órfão que a
    // extensão continuaria injetando em `process.env` sem ninguém saber.
    expect(fonte).toMatch(/secrets\.delete\(\s*"starguard\.apiKey"\s*\)/);
  });
});

describe("metadados exigidos para publicar", () => {
  it("a versão do workspace e a do lock estão sincronizadas", () => {
    // O manifesto já estava em 0.4.1 enquanto o lock continuava em 0.3.3.
    // `npm ci` e as ferramentas de release passavam a descrever versões
    // diferentes do mesmo pacote, justamente onde a versão prova qual bundle
    // o editor carregou.
    expect(lock.packages["packages/vscode"]?.version).toBe(manifesto.version);
  });

  it("a extensão pode ser testada diretamente pelo workspace", () => {
    // A suíte raiz já incluía estes arquivos, mas `npm test -w` falhava com
    // "Missing script". Um pacote publicável precisa carregar o próprio gate.
    expect(manifesto.scripts.test).toContain("vitest run");
  });

  it("o build resolve entrada e saída pelo próprio script, não pelo cwd", () => {
    const fonteBuild = readFileSync(join(aqui, "..", "build.mjs"), "utf8");
    expect(fonteBuild).toContain("fileURLToPath(import.meta.url)");
    expect(fonteBuild).toContain('join(ROOT, "src", "extension.ts")');
    expect(fonteBuild).toContain('join(ROOT, "dist", "extension.js")');
  });

  it("tem ícone declarado", () => {
    expect((manifesto as unknown as { icon?: string }).icon).toBe("icon.png");
  });

  it("a descrição avisa que precisa de conta", () => {
    // Numa Marketplace pública, a maioria de quem vê não tem conta. Dizer isso
    // na descrição é o que separa "ferramenta corporativa" de "não funciona".
    const d = (manifesto as unknown as { description: string }).description;
    expect(d.toLowerCase()).toMatch(/conta|account/);
  });
});

// ============================================================
// Nada na extensão pode ficar "carregando para sempre".
//
// Três lugares giram um relógio: o botão Analisar, o bloco de correções e o
// botão de Pull Request. Os três compartilham o mesmo desenho — uma variável
// do lado da EXTENSÃO diz se ainda está acontecendo, e o `finally` é o único
// que a desliga. O desenho só vale se o `finally` COBRIR o trecho onde o erro
// pode acontecer, e era exatamente aí que estava o furo.
//
// Testes por texto do código-fonte porque o resto deste arquivo já é assim:
// o extension host não existe em vitest, e `src/extension.ts` importa
// `vscode` na primeira linha.
// ============================================================
describe("nada fica carregando para sempre", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");
  const fontePainel = readFileSync(join(aqui, "..", "src", "painel.ts"), "utf8");

  it("`rodando = true` está DENTRO do try que tem o finally", () => {
    // Estava fora, com dois `await` entre a atribuição e o `try`. Qualquer um
    // deles falhando deixava `rodando` preso em `true`, e a partir daí todo
    // clique em Analisar caía no `if (rodando) return` — botão parado em
    // "Analisando…" até recarregar a janela.
    expect(fonte).toMatch(/try \{\s*\n\s*rodando = true;/);
  });

  it("o painel solta a referência quando o editor descarta o webview", () => {
    // A causa concreta: com `retainContextWhenHidden: false`, esconder a barra
    // lateral DESTRÓI o webview. Sem soltar a referência, o `postMessage`
    // seguinte rejeita — e essa rejeição subia por `atualizar()` até o meio de
    // `analisar()`, que morria com `rodando` em `true`.
    expect(fontePainel).toContain("view.onDidDispose(");
    expect(fontePainel).toMatch(/if \(this\.view === view\) this\.view = undefined;/);
  });

  it("desenhar a tela nunca derruba quem está fazendo o trabalho", () => {
    // Falhar em pintar a tela é um problema pequeno; falhar em terminar a
    // análise é o problema grande.
    expect(fontePainel).toMatch(/private async postar\(/);
    expect(fontePainel).toMatch(/await view\.webview\.postMessage\(msg\);\s*\n\s*\} catch \{/);
  });

  it("nenhuma proposta sobra em «gerando» quando o lote morre no meio", () => {
    // Esse estado significa "estou trabalhando nisso", e ninguém está mais.
    expect(fonte).toMatch(/if \(p\.estado === "gerando"\) p\.estado = "cancelada";/);
  });

  it("abrir o workspace do lote acontece dentro do try", () => {
    // Fora dele, uma falha ao abrir saía com todas as propostas em "gerando…"
    // e sem erro escrito em lugar nenhum.
    expect(fonte).toMatch(/let ws: Workspace \| undefined;\s*\n\s*try \{\s*\n\s*ws = await openWorkspace/);
  });

  it("o botão de PR só desliga no finally", () => {
    expect(fonte).toMatch(/if \(prNaTela\.abrindo\) prNaTela = \{ abrindo: false \};/);
  });
});

// ============================================================
// Rodar UM analisador não pode apagar o resultado dos outros.
// ============================================================
describe("o painel e o painel Problemas contam a mesma história", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");

  it("a lista da tela é acumulada POR ANALISADOR, como as coleções", () => {
    // Antes, o painel era remontado só com os analisadores da execução atual:
    // rodar só o SAST depois de uma análise completa apagava as dependências
    // da tela enquanto o painel Problemas continuava mostrando as duas coisas.
    expect(fonte).toContain("const achadosPorAnalisador = new Map<AnalyzerId, Achado[]>()");
    expect(fonte).toMatch(/achadosPorAnalisador\.set\(id, achados\.filter/);
  });

  it("montarResultado não recebe mais uma execução", () => {
    // Enquanto lia um `AnalysisRun`, ela só sabia falar da última execução.
    expect(fonte).toContain("function montarResultado(): ResultadoNaTela");
  });

  it("só o estado dos cartões DESTA execução é zerado", () => {
    expect(fonte).toContain("for (const id of select) estadoDosCartoes.delete(id);");
  });

  it("o achado corrigido sai da lista E das coleções", () => {
    // Deixá-lo ali oferecendo "Corrigir" de novo faria a segunda correção
    // partir do arquivo já reescrito e desfazer a primeira — BUG-06 entre
    // rodadas.
    expect(fonte).toContain("function retirarAchados(");
    expect(fonte).toContain("republicarDiagnosticos()");
  });

  it("limpar leva junto as propostas e o PR", () => {
    // Sobravam apontando para achados que já não existiam: o bloco continuava
    // oferecendo "Aplicar" sobre uma lista de resultado vazia.
    expect(fonte).toMatch(/achadosPorChave\.clear\(\);[\s\S]{0,600}propostas\.clear\(\);/);
  });
});

// ============================================================
// Pull Request — a saída que faltava na extensão.
// ============================================================
describe("Pull Request a partir da extensão", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");

  it("é UM PR com todas as correções, não um por achado", () => {
    // Quem recebe cinco PRs do robô no mesmo dia fecha os cinco sem ler.
    expect(fonte).toContain("openPullRequestBatch");
    expect(fonte).not.toContain("openPullRequest(");
  });

  it("o token vem do provedor de GitHub DO EDITOR", () => {
    // Pedir um Personal Access Token à parte seria inventar mais um segredo
    // para guardar — e guardar segredo é o que esta extensão evita fazer.
    expect(fonte).toMatch(/getSession\("github", \["repo"\]/);
  });

  it("um arquivo só entra uma vez, com a última versão", () => {
    // Duas correções no mesmo arquivo: a segunda já acumula a primeira.
    expect(fonte).toMatch(/porArquivo\.set\(normPath\(c\.file\), c\.fixedCode\)/);
  });

  it("sem repositório do GitHub, o motivo é dito com todas as letras", () => {
    expect(fonte).toContain("panel.prNoRepo");
  });

  it("mudança que não muda nada não vai para o PR", () => {
    expect(fonte).toMatch(/if \(c\.fixedCode === c\.originalCode\) continue;/);
  });
});

// ============================================================
// O motivo NUNCA fica sem saída — UX-15 levado até o fim.
//
// O caso que motivou: "o executável opengrep não foi encontrado neste
// computador" no cartão, e nada mais. A saída existia (uma configuração) e não
// funcionava — `packages/core/src/config.ts` congelava o valor na carga do
// módulo, antes de `aplicarConfiguracao()` escrever em `process.env`. Quem
// apontava o caminho não via diferença nenhuma.
// ============================================================
describe("cartão indisponível oferece a saída", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");
  const fonteHtml = readFileSync(join(aqui, "..", "src", "painel-html.ts"), "utf8");

  it("binário faltando oferece as DUAS respostas legítimas", () => {
    // Rodar no servidor (zero instalação) ou apontar o que já está no disco.
    // Escolher uma pela pessoa seria decidir se o código dela pode sair da
    // máquina.
    expect(fonte).toContain("starguard.configurarCaminhos");
    expect(fonte).toContain("panel.actionUseServer");
    expect(fonte).toMatch(/if \(reason !== "binary_missing"\) return \[\];/);
  });

  it("a de servidor some quando o transporte remoto já está ligado", () => {
    expect(fonte).toMatch(/!usingRemoteScan\(\)/);
  });

  it("a página desenha o botão da saída", () => {
    expect(fonteHtml).toContain("data-comando=");
    expect(fonteHtml).toContain("'acaoCartao'");
  });

  it("o comando vindo da página passa por ALLOWLIST", () => {
    // A ponte de mensagens é o limite de confiança: do outro lado dela há
    // título de regra do Opengrep, nome de pacote do Trivy e texto de modelo.
    // Aceitar qualquer id daí seria deixar o conteúdo analisado executar
    // comando do editor.
    expect(fonte).toMatch(/const permitido = SAIDAS\.some/);
    expect(fonte).toMatch(/if \(!permitido\)/);
  });

  it("a configuração de caminho é APAGADA quando o campo fica vazio", () => {
    // `process.env` do extension host vive enquanto o editor viver: sem isto,
    // apontar um binário errado uma vez seria irreversível sem reiniciar.
    expect(fonte).toMatch(/else delete process\.env\[nome\];/);
  });

  it("o ruleset local do SAST tem configuração própria", () => {
    // Sem ela, "auto" baixa o ruleset de semgrep.dev a cada análise e falha em
    // máquina sem saída para a internet — como erro de rede, não como
    // configuração faltando.
    expect(fonte).toContain('definir("SAST_RULES", regras)');
    const manifestoProps = (
      manifesto.contributes as { configuration: { properties: Record<string, unknown> } }
    ).configuration.properties;
    expect(manifestoProps["starguard.sastRules"]).toBeDefined();
  });
});

describe("correção em lote tem pré-voo e retorno visível", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");

  it("prepara conta, workspace e IA antes de gerar", () => {
    expect(fonte).toMatch(/async function prepararCorrecao[\s\S]*pedirContaComServidorPronto/);
    expect(fonte).toMatch(/async function prepararCorrecao[\s\S]*configurarIa\(ctxGlobal\)/);
    expect(fonte).toMatch(/async function corrigirLote[\s\S]*await prepararCorrecao\(\)/);
  });

  it("bloqueia lotes concorrentes e sempre encerra o estado ocupado", () => {
    expect(fonte).toMatch(/if \(preparandoCorrecao \|\| abortarCorrecao\) return/);
    expect(fonte).toMatch(/finally \{[\s\S]*preparandoCorrecao = false;[\s\S]*abortarCorrecao = undefined/);
  });

  it("resume falhas em notificação e oferece o canal de detalhes", () => {
    expect(fonte).toContain('t("panel.fixFailed"');
    expect(fonte).toContain("saida.show()");
  });
});
