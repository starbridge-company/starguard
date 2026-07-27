import { describe, it, expect, vi, beforeEach } from "vitest";

// O Octokit é mockado: assim os caminhos de PR — que antes exigiam um
// repositório e um token reais — passam a ter cobertura.
// Resolve AUDITORIA.md#PEND-04 e #PEND-06.
const criados: { path: string; content: string; branch: string }[] = [];
const refsCriadas: string[] = [];
const prsAbertos: { head: string; title: string }[] = [];

const octokitFake = {
  rest: {
    repos: {
      get: vi.fn(async () => ({ data: { default_branch: "main" } })),
      getContent: vi.fn(async () => {
        throw new Error("not found"); // arquivo novo
      }),
      createOrUpdateFileContents: vi.fn(async (a: Record<string, string>) => {
        criados.push({
          path: a.path!,
          content: Buffer.from(a.content!, "base64").toString("utf8"),
          branch: a.branch!,
        });
        return { data: {} };
      }),
    },
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: "abc123" } } })),
      createRef: vi.fn(async (a: Record<string, string>) => {
        refsCriadas.push(a.ref!);
        return { data: {} };
      }),
    },
    pulls: {
      create: vi.fn(async (a: Record<string, string>) => {
        prsAbertos.push({ head: a.head!, title: a.title! });
        return { data: { number: 42, html_url: "https://github.com/o/r/pull/42" } };
      }),
    },
  },
};

vi.mock("octokit", () => ({
  // `new Octokit(...)`: precisa ser construtor, não arrow function.
  Octokit: class {
    rest = octokitFake.rest;
  },
}));

const { openPullRequest, openPullRequestBatch } = await import("@/lib/github");

beforeEach(() => {
  criados.length = 0;
  refsCriadas.length = 0;
  prsAbertos.length = 0;
});

describe("openPullRequest", () => {
  it("cria branch a partir da default e commita o arquivo", async () => {
    const pr = await openPullRequest({
      repoUrl: "https://github.com/acme/app",
      file: "src/a.js",
      fixedCode: "corrigido",
      title: "Correção",
      token: "ghp_teste",
    });
    expect(pr.number).toBe(42);
    expect(refsCriadas[0]).toMatch(/^refs\/heads\/starguard\/fix-/);
    expect(criados).toHaveLength(1);
    expect(criados[0]).toMatchObject({ path: "src/a.js", content: "corrigido" });
  });

  it("normaliza separador do Windows no caminho", async () => {
    await openPullRequest({
      repoUrl: "https://github.com/acme/app",
      file: "src\\api\\a.js",
      fixedCode: "x",
      title: "t",
      token: "ghp_teste",
    });
    expect(criados[0]?.path).toBe("src/api/a.js");
  });

  it("sem token, recusa antes de tocar no GitHub", async () => {
    const semToken = { ...process.env };
    delete process.env.GITHUB_TOKEN;
    await expect(
      openPullRequest({
        repoUrl: "https://github.com/acme/app",
        file: "a.js",
        fixedCode: "x",
        title: "t",
      })
    ).rejects.toThrow(/GITHUB_TOKEN/);
    process.env = semToken;
  });

  it("recusa URL fora da allowlist (anti-SSRF)", async () => {
    await expect(
      openPullRequest({
        repoUrl: "https://gitlab.com/acme/app",
        file: "a.js",
        fixedCode: "x",
        title: "t",
        token: "ghp_teste",
      })
    ).rejects.toThrow(/inválida/i);
  });
});

// AUDITORIA.md#BUG-07 / #PEND-06 — a correção do agente pode tocar vários
// arquivos; todos precisam entrar no MESMO PR.
describe("openPullRequestBatch · BUG-07", () => {
  it("commita todos os arquivos numa única branch e num único PR", async () => {
    const pr = await openPullRequestBatch({
      repoUrl: "https://github.com/acme/app",
      files: [
        { file: "src/a.js", fixedCode: "A" },
        { file: "src/b.js", fixedCode: "B" },
        { file: "src/c.js", fixedCode: "C" },
      ],
      title: "Correções",
      token: "ghp_teste",
    });
    expect(pr.committed).toBe(3);
    expect(criados.map((c) => c.path)).toEqual(["src/a.js", "src/b.js", "src/c.js"]);
    // Uma branch só, um PR só.
    expect(refsCriadas).toHaveLength(1);
    expect(prsAbertos).toHaveLength(1);
    expect(new Set(criados.map((c) => c.branch)).size).toBe(1);
  });

  it("deduplica caminho repetido em vez de commitar duas vezes", async () => {
    const pr = await openPullRequestBatch({
      repoUrl: "https://github.com/acme/app",
      files: [
        { file: "src/a.js", fixedCode: "primeiro" },
        { file: "src\\a.js", fixedCode: "segundo" },
      ],
      title: "t",
      token: "ghp_teste",
    });
    expect(pr.committed).toBe(1);
    expect(criados).toHaveLength(1);
  });
});
