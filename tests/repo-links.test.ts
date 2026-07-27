import { describe, it, expect } from "vitest";
import { repoFileLink } from "@/lib/repo-links";

// AUDITORIA.md#UX-08 — do card para a linha exata no GitHub, em um clique.

const REPO = "https://github.com/acme/app";

describe("repoFileLink · UX-08", () => {
  it("monta o link com a linha destacada", () => {
    expect(repoFileLink(REPO, "src/api/user.ts", 42)?.url).toBe(
      "https://github.com/acme/app/blob/HEAD/src/api/user.ts#L42"
    );
  });

  it("destaca a faixa quando há endLine", () => {
    expect(repoFileLink(REPO, "src/a.ts", 10, 18)?.url).toBe(
      "https://github.com/acme/app/blob/HEAD/src/a.ts#L10-L18"
    );
  });

  it("ignora endLine que não é maior que line", () => {
    expect(repoFileLink(REPO, "src/a.ts", 10, 10)?.url).toMatch(/#L10$/);
    expect(repoFileLink(REPO, "src/a.ts", 10, 4)?.url).toMatch(/#L10$/);
  });

  it("sem linha (o scanner não localizou), linka o arquivo sem âncora", () => {
    expect(repoFileLink(REPO, "src/a.ts", 0)?.url).toBe(
      "https://github.com/acme/app/blob/HEAD/src/a.ts"
    );
  });

  it("normaliza separador do Windows e './' inicial", () => {
    expect(repoFileLink(REPO, ".\\src\\api\\user.ts", 1)?.url).toBe(
      "https://github.com/acme/app/blob/HEAD/src/api/user.ts#L1"
    );
  });

  it("escapa caractere especial no nome do arquivo, sem escapar a barra", () => {
    const url = repoFileLink(REPO, "src/[id]/page tsx.ts", 3)!.url;
    expect(url).toContain("/blob/HEAD/src/%5Bid%5D/page%20tsx.ts");
    expect(url).toContain("#L3");
  });

  it("normaliza a URL do repo (sufixo .git, www)", () => {
    expect(repoFileLink("https://www.github.com/acme/app.git", "a.ts")?.url).toBe(
      "https://github.com/acme/app/blob/HEAD/a.ts"
    );
  });

  // Sem estes, um repoUrl vindo do banco poderia virar link para qualquer host.
  it("recusa repositório fora da allowlist", () => {
    expect(repoFileLink("https://gitlab.com/acme/app", "a.ts")).toBeNull();
    expect(repoFileLink("javascript:alert(1)", "a.ts")).toBeNull();
  });

  it("recusa caminho que escapa do repositório", () => {
    expect(repoFileLink(REPO, "../../etc/passwd")).toBeNull();
  });

  it("recusa o placeholder de arquivo desconhecido da revisão por IA", () => {
    expect(repoFileLink(REPO, "desconhecido", 0)).toBeNull();
    expect(repoFileLink(REPO, "unknown", 0)).toBeNull();
  });

  it("sem repositório (análise sem repo) não há link", () => {
    expect(repoFileLink(null, "a.ts", 1)).toBeNull();
    expect(repoFileLink(REPO, "")).toBeNull();
    expect(repoFileLink(REPO, "   ")).toBeNull();
  });

  it("avisa que o link aponta para o HEAD atual, não para o código escaneado", () => {
    expect(repoFileLink(REPO, "a.ts", 1)?.atCurrentHead).toBe(true);
  });
});
