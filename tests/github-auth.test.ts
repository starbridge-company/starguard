import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveGitHubToken,
  requireGitHubToken,
  tokenForPullRequest,
  isSingleTenant,
  GitHubTokenRequired,
} from "@starguard/core/github-auth";

// Regra de segurança: o caminho NEGATIVO é o que precisa estar travado — o
// token do servidor não pode agir em nome de quem não o forneceu.
// Protege AUDITORIA.md#SEC-06.

const original = {
  single: process.env.SINGLE_TENANT,
  token: process.env.GITHUB_TOKEN,
};

beforeEach(() => {
  delete process.env.SINGLE_TENANT;
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  if (original.single === undefined) delete process.env.SINGLE_TENANT;
  else process.env.SINGLE_TENANT = original.single;
  if (original.token === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = original.token;
});

describe("resolveGitHubToken · SEC-06", () => {
  it("NÃO empresta o token do servidor num deploy multi-usuário", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(isSingleTenant()).toBe(false);
    expect(resolveGitHubToken(undefined)).toBeUndefined();
  });

  it("também não empresta quando SINGLE_TENANT vem com qualquer coisa != true", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    for (const v of ["false", "1", "yes", "TRUE", ""]) {
      process.env.SINGLE_TENANT = v;
      expect(resolveGitHubToken(undefined)).toBeUndefined();
    }
  });

  it("empresta o token do servidor só com SINGLE_TENANT=true explícito", () => {
    process.env.SINGLE_TENANT = "true";
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(resolveGitHubToken(undefined)).toBe("ghp_doServidor");
  });

  it("o token do usuário sempre prevalece sobre o do servidor", () => {
    process.env.SINGLE_TENANT = "true";
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(resolveGitHubToken("ghp_doUsuario")).toBe("ghp_doUsuario");
  });

  it("token em branco não conta como token", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(resolveGitHubToken("   ")).toBeUndefined();
  });

  it("lê a env a cada chamada — a decisão não fica congelada na carga do módulo", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(resolveGitHubToken()).toBeUndefined();
    process.env.SINGLE_TENANT = "true";
    expect(resolveGitHubToken()).toBe("ghp_doServidor");
  });
});

describe("requireGitHubToken · SEC-06 (escrita)", () => {
  it("recusa abrir PR sem token do usuário, mesmo com token no servidor", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(() => requireGitHubToken(undefined)).toThrow(GitHubTokenRequired);
  });

  it("a mensagem é acionável: diz o que fazer", () => {
    expect(() => requireGitHubToken(undefined)).toThrow(/token do GitHub/i);
  });

  it("aceita o token do próprio usuário", () => {
    expect(requireGitHubToken("ghp_doUsuario")).toBe("ghp_doUsuario");
  });
});

// Regra do produto: repositório PÚBLICO usa o token do servidor (não há dado
// privado em jogo — qualquer um poderia abrir o mesmo PR por um fork).
// Repositório PRIVADO exige o token do usuário, sempre.
describe("tokenForPullRequest · público × privado", () => {
  it("público sem token do usuário: usa o do servidor", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(tokenForPullRequest({ isPrivate: false })).toBe("ghp_doServidor");
  });

  it("público NÃO exige SINGLE_TENANT — o risco do SEC-06 não existe aqui", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    delete process.env.SINGLE_TENANT;
    expect(tokenForPullRequest({ isPrivate: false })).toBe("ghp_doServidor");
  });

  it("PRIVADO recusa o token do servidor — é o furo do SEC-06", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    process.env.SINGLE_TENANT = "true";
    expect(() => tokenForPullRequest({ isPrivate: true })).toThrow(
      GitHubTokenRequired
    );
  });

  it("privado diz POR QUE precisa do token", () => {
    expect(() => tokenForPullRequest({ isPrivate: true })).toThrow(/privado/i);
  });

  it("token do usuário prevalece nos dois casos", () => {
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    expect(tokenForPullRequest({ userToken: "ghp_meu", isPrivate: true })).toBe(
      "ghp_meu"
    );
    expect(tokenForPullRequest({ userToken: "ghp_meu", isPrivate: false })).toBe(
      "ghp_meu"
    );
  });

  it("público sem token nenhum ainda pede — não há como assinar o PR", () => {
    delete process.env.GITHUB_TOKEN;
    expect(() => tokenForPullRequest({ isPrivate: false })).toThrow(
      GitHubTokenRequired
    );
  });
});
