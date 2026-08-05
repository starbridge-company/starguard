// ============================================================
// PKCE e clientes — AUDITORIA.md#SEC-10.
//
// Este arquivo é quase inteiro de CAMINHO NEGATIVO, e é de propósito: num
// fluxo de autorização, o que importa não é que o caso feliz funcione — é que
// tudo o mais seja recusado. Um `redirect_uri` aceito por engano entrega o
// código de autorização a quem controla o destino, e aí nenhuma outra defesa
// alcança.
// ============================================================
import { describe, it, expect } from "vitest";
import {
  deriveChallenge,
  generateCodeVerifier,
  generateState,
  isS256,
  isValidVerifier,
  verifyChallenge,
} from "@/lib/oauth/pkce";
import { getClient, redirectUriPermitido } from "@/lib/oauth/clients";

describe("code_challenge_method", () => {
  it("aceita S256", () => {
    expect(isS256("S256")).toBe(true);
  });

  it("RECUSA `plain`", () => {
    // Em `plain` o desafio É o verificador em texto: quem intercepta o pedido
    // de autorização já tem o que precisa para trocar o código. É PKCE no nome
    // e nada na prática — e nossos clientes são novos, não há compatibilidade
    // a preservar.
    expect(isS256("plain")).toBe(false);
  });

  it("recusa variação de caixa e valor vazio", () => {
    expect(isS256("s256")).toBe(false);
    expect(isS256("")).toBe(false);
    expect(isS256(undefined)).toBe(false);
    expect(isS256(null)).toBe(false);
  });
});

describe("verificador e desafio", () => {
  it("o caso feliz casa", () => {
    const v = generateCodeVerifier();
    expect(verifyChallenge(v, deriveChallenge(v))).toBe(true);
  });

  it("verificador ERRADO é recusado", () => {
    // É a garantia central do PKCE: sem o verificador, o código não vira token.
    const certo = generateCodeVerifier();
    const outro = generateCodeVerifier();
    expect(verifyChallenge(outro, deriveChallenge(certo))).toBe(false);
  });

  it("um caractere diferente já recusa", () => {
    const v = generateCodeVerifier();
    const desafio = deriveChallenge(v);
    const quaseIgual = v.slice(0, -1) + (v.endsWith("A") ? "B" : "A");
    expect(verifyChallenge(quaseIgual, desafio)).toBe(false);
  });

  it("verificador fora do alfabeto ou do tamanho da RFC é recusado", () => {
    expect(isValidVerifier("curto")).toBe(false);
    expect(isValidVerifier("a".repeat(42))).toBe(false);
    expect(isValidVerifier("a".repeat(129))).toBe(false);
    expect(isValidVerifier("a".repeat(43) + "!")).toBe(false);
    expect(isValidVerifier(undefined)).toBe(false);
    // 43 é o tamanho de um SHA-256 em base64url — o piso da RFC.
    expect(isValidVerifier("a".repeat(43))).toBe(true);
  });

  it("verificador inválido não passa nem com o desafio correspondente", () => {
    // Sem esta guarda, um cliente poderia usar "a" como verificador e o
    // desafio derivado dele — tecnicamente casa, e destrói a entropia.
    const fraco = "a";
    expect(verifyChallenge(fraco, deriveChallenge(fraco))).toBe(false);
  });

  it("o desafio é base64url, sem preenchimento", () => {
    const d = deriveChallenge(generateCodeVerifier());
    expect(d).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(d).not.toContain("=");
  });

  it("verificadores sorteados não se repetem", () => {
    const amostra = new Set(Array.from({ length: 200 }, () => generateCodeVerifier()));
    expect(amostra.size).toBe(200);
  });

  it("o state também é aleatório e sem preenchimento", () => {
    const amostra = new Set(Array.from({ length: 200 }, () => generateState()));
    expect(amostra.size).toBe(200);
    expect(generateState()).not.toContain("=");
  });
});

describe("registro de clientes", () => {
  it("conhece os dois clientes públicos e recusa o resto", () => {
    expect(getClient("starguard-vscode")).toBeDefined();
    expect(getClient("starguard-cli")).toBeDefined();
    expect(getClient("starguard-web")).toBeUndefined();
    expect(getClient("")).toBeUndefined();
    expect(getClient(undefined)).toBeUndefined();
  });

  it("todo cliente declara o que vai poder fazer", () => {
    // A tela de consentimento lê isto. Cliente sem escopo declarado pediria
    // autorização sem dizer para quê.
    for (const c of [getClient("starguard-vscode")!, getClient("starguard-cli")!]) {
      expect(c.scopeKeys.length).toBeGreaterThan(0);
      expect(c.nameKey).toMatch(/^oauth\.client\./);
    }
  });
});

describe("redirect_uri — a fronteira do fluxo", () => {
  describe("extensão do VS Code", () => {
    const permite = (u: string) => redirectUriPermitido("starguard-vscode", u);

    it("aceita o id da extensão nos esquemas de editor conhecidos", () => {
      // Recusar todos menos `vscode://` faria o login não voltar para quem usa
      // Insiders, Cursor ou VSCodium — e sem mensagem, porque o erro
      // aconteceria no navegador.
      for (const esq of ["vscode", "vscode-insiders", "vscodium", "cursor", "windsurf"]) {
        expect(permite(`${esq}://starbridge.starguard-vscode/auth`), esq).toBe(true);
      }
    });

    it("RECUSA outra extensão no mesmo esquema", () => {
      // O ataque real: esquema conhecido, extensão do atacante. Se passasse, o
      // código de autorização seria entregue a ela.
      expect(permite("vscode://outra.extensao/auth")).toBe(false);
      expect(permite("vscode://starbridge.starguard-vscode-falso/auth")).toBe(false);
      // O id ANTERIOR (publisher `starguard`) também deixou de valer: a troca
      // de publisher precisa ser completa dos dois lados, senão o servidor
      // aceitaria um redirect de uma extensão que já não é a nossa.
      expect(permite("vscode://starguard.starguard-vscode/auth")).toBe(false);
    });

    it("RECUSA caminho diferente de /auth", () => {
      expect(permite("vscode://starbridge.starguard-vscode/outra-rota")).toBe(false);
      expect(permite("vscode://starbridge.starguard-vscode/")).toBe(false);
    });

    it("RECUSA esquema desconhecido, http e https", () => {
      expect(permite("evil://starbridge.starguard-vscode/auth")).toBe(false);
      expect(permite("http://starbridge.starguard-vscode/auth")).toBe(false);
      expect(permite("https://starbridge.starguard-vscode/auth")).toBe(false);
    });

    it("RECUSA query e fragmento", () => {
      // Query extra abre espaço para ambiguidade na comparação; fragmento nem
      // chega ao servidor. A forma aceita é uma só.
      expect(permite("vscode://starbridge.starguard-vscode/auth?x=1")).toBe(false);
      expect(permite("vscode://starbridge.starguard-vscode/auth#x")).toBe(false);
    });

    it("RECUSA lixo que não é URI", () => {
      expect(permite("")).toBe(false);
      expect(permite("não é uri")).toBe(false);
      expect(permite("/auth")).toBe(false);
    });
  });

  describe("CLI (loopback, RFC 8252)", () => {
    const permite = (u: string) => redirectUriPermitido("starguard-cli", u);

    it("aceita QUALQUER porta em 127.0.0.1", () => {
      // A porta é efêmera: o sistema escolhe na hora. Fixá-la quebraria o login
      // sempre que a porta estivesse ocupada.
      for (const porta of [1024, 8080, 49152, 65535]) {
        expect(permite(`http://127.0.0.1:${porta}/callback`), String(porta)).toBe(true);
      }
      expect(permite("http://127.0.0.1/callback")).toBe(true);
      expect(permite("http://[::1]:5000/callback")).toBe(true);
    });

    it("RECUSA `localhost`", () => {
      // `localhost` resolve por DNS: num host envenenado aponta para outra
      // máquina. `127.0.0.1` é literal e não passa por resolução.
      expect(permite("http://localhost:8080/callback")).toBe(false);
    });

    it("RECUSA host externo, mesmo com o caminho certo", () => {
      expect(permite("http://exemplo.com/callback")).toBe(false);
      expect(permite("http://127.0.0.1.exemplo.com/callback")).toBe(false);
      expect(permite("https://exemplo.com/callback")).toBe(false);
    });

    it("RECUSA caminho diferente de /callback", () => {
      expect(permite("http://127.0.0.1:8080/roubar")).toBe(false);
      expect(permite("http://127.0.0.1:8080/")).toBe(false);
    });

    it("RECUSA o esquema da extensão", () => {
      // Cada cliente aceita o SEU destino. Cruzar os dois faria um código
      // emitido para o CLI voltar para a extensão.
      expect(permite("vscode://starbridge.starguard-vscode/auth")).toBe(false);
    });
  });

  it("cliente desconhecido não tem destino permitido", () => {
    expect(redirectUriPermitido("inventado", "http://127.0.0.1:8080/callback")).toBe(false);
  });

  it("a comparação é por ESTRUTURA, não por prefixo", () => {
    // `startsWith` deixaria passar um domínio que só começa igual.
    expect(
      redirectUriPermitido("starguard-cli", "http://127.0.0.1@malicioso.com/callback")
    ).toBe(false);
  });
});
