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
  contributes: Record<string, unknown>;
};
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
  // que põe a árvore como uma SEÇÃO dentro do Explorer, abaixo de Outline e
  // Timeline. Não há ícone na barra de atividades, e quem instala procura ali
  // — então a extensão simplesmente "não aparece", sem erro nenhum.
  const c = manifesto.contributes as {
    viewsContainers?: { activitybar?: Array<{ id: string; icon: string }> };
    views: Record<string, Array<{ id: string }>>;
  };

  it("tem contêiner PRÓPRIO na barra de atividades", () => {
    const cont = c.viewsContainers?.activitybar?.[0];
    expect(cont).toBeDefined();
    expect(cont!.id).toBe("starguard");
  });

  it("o ícone do contêiner é SVG — o VS Code aplica máscara e tema", () => {
    // PNG aqui aparece sem tratamento de tema e destoa dos vizinhos.
    expect(c.viewsContainers!.activitybar![0]!.icon).toMatch(/\.svg$/);
  });

  it("a árvore vive no contêiner próprio, NÃO no explorer", () => {
    expect(c.views.explorer).toBeUndefined();
    expect(c.views.starguard?.[0]?.id).toBe("starguard.analyzers");
  });

  it("ativa na inicialização — o painel tem de estar pronto ao primeiro clique", () => {
    // Sem isto, quem já está logado vê a tela de "Entrar" piscar antes de o
    // contexto `starguard.signedIn` ser resolvido.
    const eventos = (manifesto as unknown as { activationEvents: string[] }).activationEvents;
    expect(eventos).toContain("onStartupFinished");
    // `onUri` é o retorno do navegador no login: sem ele o código de
    // autorização chega e ninguém está escutando.
    expect(eventos).toContain("onUri");
  });
});

describe("o portão de login está declarado no manifesto", () => {
  const c = manifesto.contributes as {
    viewsWelcome?: Array<{ view: string; when?: string; contents: string }>;
    menus: Record<string, Array<{ command: string; when?: string }>>;
  };

  it("a árvore tem tela de boas-vindas para quem NÃO entrou", () => {
    // Sem ela, quem instala da Marketplace vê uma lista vazia e nenhuma pista
    // do que fazer — e a via de contato vira a aba de avaliações.
    const bemVindo = c.viewsWelcome?.find((v) => v.view === "starguard.analyzers");
    expect(bemVindo).toBeDefined();
    expect(bemVindo!.when).toBe("!starguard.signedIn");
  });

  it("a tela oferece ENTRAR e SOLICITAR ACESSO", () => {
    const conteudo = c.viewsWelcome![0]!.contents;
    expect(conteudo).toContain("command:starguard.signIn");
    expect(conteudo).toContain("command:starguard.requestAccess");
  });

  it("o ▶ por analisador só aparece com sessão", () => {
    // Um botão que sempre responde "faça login" treina a pessoa a ignorá-lo.
    const item = c.menus["view/item/context"]![0]!;
    expect(item.when).toContain("starguard.signedIn");
  });

  it("o `analisar tudo` da barra de título também", () => {
    const titulo = c.menus["view/title"]!.find((m) => m.command === "starguard.runAll");
    expect(titulo!.when).toContain("starguard.signedIn");
  });
});

describe("a árvore fica VAZIA sem sessão — é o que revela o botão Entrar", () => {
  // Nasceu de um caso REAL na v0.1.1: o ícone já aparecia na barra lateral,
  // mas o painel abria com os cinco analisadores riscados e NENHUM botão de
  // entrar. O `viewsWelcome` do VS Code só é renderizado quando o provider
  // devolve zero filhos da raiz — devolver os analisadores desabilitados
  // escondia a única saída que a tela tinha.
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");

  it("`getChildren` da raiz desiste quando não há sessão", () => {
    expect(fonte).toMatch(/if\s*\(!this\.logado\)\s*return\s*\[\]/);
  });

  it("o estado de sessão chega ao provider, não só ao `setContext`", () => {
    // `setContext` governa os BOTÕES; quem esvazia a árvore é o provider. Ter
    // só o primeiro foi exatamente o bug.
    expect(fonte).toContain("definirSessao");
    expect(fonte).toMatch(/arvore\?\.definirSessao\(!!sessao\)/);
  });
});

describe("o painel bloqueado oferece a saída, não só o diagnóstico", () => {
  const fonte = readFileSync(join(aqui, "..", "src", "extension.ts"), "utf8");

  it("cada motivo de indisponibilidade tem uma ação correspondente", () => {
    // Sem isto o painel diz "falta a descrição do sistema" e deixa a pessoa
    // procurando onde se configura isso. Ver AUDITORIA.md#UX-15.
    for (const razao of [
      "binary_missing",
      "no_workspace",
      "no_ai_key",
      "engine_off",
      "no_input",
    ]) {
      expect(fonte, razao).toContain(`case "${razao}":`);
    }
  });

  it("o comando da ação de IA está declarado no manifesto", () => {
    // Ação que aponta para comando inexistente falha em silêncio no clique.
    const cmds = (
      manifesto.contributes as { commands: Array<{ command: string }> }
    ).commands.map((c) => c.command);
    expect(cmds).toContain("starguard.enableAccountAi");
  });

  it("a disponibilidade é recalculada com a IA da conta já ligada", () => {
    // `hasAnyAiKey()` responde `true` no transporte remoto. Sem ligar o
    // transporte ANTES de montar o plano, a árvore anunciava "precisa de uma
    // chave de IA" para quem fez login justamente para não precisar de uma.
    expect(fonte).toMatch(/await ligarIaSeJaConsentiu\(\);\s*\n\s*const execPlan/);
  });

  it("ligar a IA para a árvore NÃO abre modal de consentimento", () => {
    // Desenhar um painel não é hora de pedir autorização para mandar código
    // para fora: aqui só se lê um consentimento já dado.
    const corpo = fonte.slice(
      fonte.indexOf("async function ligarIaSeJaConsentiu"),
      fonte.indexOf("function raiz()")
    );
    expect(corpo).not.toContain("showWarningMessage");
    expect(corpo).toContain("globalState.get");
  });
});

describe("metadados exigidos para publicar", () => {
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
