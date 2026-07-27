import { describe, it, expect, vi, beforeEach } from "vitest";

// O Octokit é mockado: assim os caminhos de PR — que antes exigiam um
// repositório e um token reais — passam a ter cobertura.
// Resolve AUDITORIA.md#PEND-04 e #PEND-06.
const criados: { path: string; content: string; branch: string }[] = [];
const refsCriadas: string[] = [];
const prsAbertos: { head: string; title: string }[] = [];
// Caminho do lote (Git Data API): blobs, árvore, commit, ref.
const blobsCriados: string[] = [];
const arvores: string[][] = [];
const commits: string[] = [];
const refsAtualizadas: string[] = [];

const octokitFake = {
  rest: {
    repos: {
      // `private` fica no tipo para os testes poderem simular repositório
      // privado — é o que decide de quem é o token que abre o PR.
      get: vi.fn(
        async (): Promise<{
          data: { default_branch: string; private?: boolean };
        }> => ({ data: { default_branch: "main" } })
      ),
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
      // O lote passou a usar a Git Data API: blobs em paralelo, UMA árvore,
      // UM commit. Antes eram duas chamadas e um commit por arquivo, em série.
      getCommit: vi.fn(async () => ({ data: { tree: { sha: "tree-base" } } })),
      createBlob: vi.fn(async (a: Record<string, string>) => {
        const conteudo = Buffer.from(a.content!, "base64").toString("utf8");
        blobsCriados.push(conteudo);
        return { data: { sha: `blob-${blobsCriados.length}` } };
      }),
      createTree: vi.fn(
        async (a: { tree: { path: string; sha: string }[] }) => {
          arvores.push(a.tree.map((t) => t.path));
          return { data: { sha: "tree-nova" } };
        }
      ),
      createCommit: vi.fn(async (a: Record<string, string>) => {
        commits.push(a.message!);
        return { data: { sha: "commit-1" } };
      }),
      updateRef: vi.fn(async (a: Record<string, string>) => {
        refsAtualizadas.push(a.ref!);
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
  blobsCriados.length = 0;
  arvores.length = 0;
  commits.length = 0;
  refsAtualizadas.length = 0;
  vi.clearAllMocks();
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

  it("sem token nenhum (nem do servidor), recusa antes de tocar no GitHub", async () => {
    const semToken = { ...process.env };
    delete process.env.GITHUB_TOKEN;
    await expect(
      openPullRequest({
        // URL distinta por teste: a visibilidade fica em cache por 5 min.
        repoUrl: "https://github.com/acme/sem-token",
        file: "a.js",
        fixedCode: "x",
        title: "t",
      })
    ).rejects.toThrow(/token do GitHub/i);
    process.env = semToken;
  });

  // Regra do produto: repositório PÚBLICO usa o token do servidor — não há
  // dado privado em jogo, qualquer um poderia abrir o mesmo PR por um fork.
  // O `repos.get` mockado não devolve `private`, então o repo é público.
  it("repositório público abre o PR com o token do servidor", async () => {
    const antes = { ...process.env };
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    delete process.env.SINGLE_TENANT;
    await openPullRequest({
      repoUrl: "https://github.com/acme/publico",
      file: "a.js",
      fixedCode: "x",
      title: "t",
    });
    expect(prsAbertos).toHaveLength(1);
    process.env = antes;
  });

  // Em repositório PRIVADO o token do servidor continua barrado: emprestá-lo
  // daria acesso de escrita a todo repositório privado que ele alcança.
  // Ver AUDITORIA.md#SEC-06.
  it("repositório privado recusa o token do servidor", async () => {
    const antes = { ...process.env };
    process.env.GITHUB_TOKEN = "ghp_doServidor";
    process.env.SINGLE_TENANT = "true";
    octokitFake.rest.repos.get.mockResolvedValueOnce({
      data: { default_branch: "main", private: true },
    });
    await expect(
      openPullRequest({
        repoUrl: "https://github.com/acme/privado",
        file: "a.js",
        fixedCode: "x",
        title: "t",
      })
    ).rejects.toThrow(/privado/i);
    expect(prsAbertos).toHaveLength(0);
    process.env = antes;
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
    expect(arvores[0]).toEqual(["src/a.js", "src/b.js", "src/c.js"]);
    expect(blobsCriados).toEqual(["A", "B", "C"]);
    // Uma branch só, um PR só.
    expect(refsCriadas).toHaveLength(1);
    expect(prsAbertos).toHaveLength(1);
  });

  // O laço antigo fazia DUAS chamadas e um commit por arquivo, em série: 33
  // arquivos custavam 66 idas ao GitHub e mais de um minuto. Este teste trava
  // o custo em O(1) chamadas de escrita de árvore/commit.
  it("gera UM commit, não um por arquivo", async () => {
    await openPullRequestBatch({
      repoUrl: "https://github.com/acme/app",
      files: Array.from({ length: 30 }, (_, i) => ({
        file: `src/f${i}.js`,
        fixedCode: `conteudo ${i}`,
      })),
      title: "Correções",
      token: "ghp_teste",
    });
    expect(commits).toHaveLength(1);
    expect(arvores).toHaveLength(1);
    expect(arvores[0]).toHaveLength(30);
    expect(refsAtualizadas).toHaveLength(1);
    // E nenhuma chamada ao caminho antigo, que era o lento.
    expect(octokitFake.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(octokitFake.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it("deduplica caminho repetido — o último conteúdo vence", async () => {
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
    expect(arvores[0]).toEqual(["src/a.js"]);
    // O segundo já acumula a correção do primeiro; ficar com ele é o certo.
    expect(blobsCriados).toEqual(["segundo"]);
  });
});
