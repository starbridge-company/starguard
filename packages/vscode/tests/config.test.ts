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

  it("o cartão anuncia quando o analisador roda no servidor", () => {
    expect(fonte).toContain("remoto: remoto && (id === \"sast\" || id === \"sca\")");
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
