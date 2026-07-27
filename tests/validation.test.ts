import { describe, it, expect } from "vitest";
import {
  parseGitHubRepo,
  validate,
  step4Schema,
  findingStatusSchema,
  analyzeSchema,
  loginSchema,
} from "@/lib/validation";
import { parsePageParams, MAX_PAGE_SIZE } from "@/lib/pagination";

// Allowlist anti-SSRF: o scan clona o que passar por aqui.
describe("parseGitHubRepo · anti-SSRF", () => {
  it("aceita repositório do github.com", () => {
    expect(parseGitHubRepo("https://github.com/acme/app")).toMatchObject({
      owner: "acme",
      repo: "app",
      url: "https://github.com/acme/app",
    });
  });

  it("remove credenciais embutidas na URL", () => {
    const r = parseGitHubRepo("https://user:senha@github.com/acme/app");
    expect(r?.url).toBe("https://github.com/acme/app");
    expect(r?.url).not.toContain("senha");
  });

  it("recusa outro host, http e caminho incompleto", () => {
    expect(parseGitHubRepo("https://gitlab.com/acme/app")).toBeNull();
    expect(parseGitHubRepo("http://github.com/acme/app")).toBeNull();
    expect(parseGitHubRepo("https://github.com/acme")).toBeNull();
    expect(parseGitHubRepo("https://evil.com/#github.com/a/b")).toBeNull();
    expect(parseGitHubRepo("não é url")).toBeNull();
  });

  it("recusa host que apenas TERMINA em github.com", () => {
    expect(parseGitHubRepo("https://notgithub.com/a/b")).toBeNull();
    expect(parseGitHubRepo("https://github.com.evil.io/a/b")).toBeNull();
  });
});

// AUDITORIA.md#BUG-06 — vários achados do mesmo arquivo numa passada só.
describe("step4Schema · BUG-06", () => {
  const base = {
    vulnerabilityId: "V-1",
    file: "src/db.js",
    originalCode: "query(sql)",
    description: "SQL injection",
  };

  it("aceita achados adicionais do mesmo arquivo", () => {
    const r = validate(step4Schema, {
      ...base,
      alsoFix: [{ vulnerabilityId: "V-2", description: "outro problema", line: 40 }],
    });
    expect(r.ok).toBe(true);
  });

  it("recusa achado adicional sem descrição", () => {
    const r = validate(step4Schema, { ...base, alsoFix: [{ semDescricao: true }] });
    expect(r.ok).toBe(false);
  });

  it("aceita findingId/force do cache de correção (FEAT-02)", () => {
    const r = validate(step4Schema, {
      ...base,
      findingId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      force: true,
    });
    expect(r.ok).toBe(true);
  });
});

// AUDITORIA.md#FEAT-01
describe("findingStatusSchema · FEAT-01", () => {
  it("aceita os estados previstos", () => {
    for (const status of ["open", "fixed", "false_positive", "accepted_risk"]) {
      expect(validate(findingStatusSchema, { status }).ok).toBe(true);
    }
  });
  it("recusa estado inventado", () => {
    expect(validate(findingStatusSchema, { status: "inventado" }).ok).toBe(false);
  });
});

describe("analyzeSchema e loginSchema", () => {
  it("exige nome e descrição do projeto", () => {
    expect(validate(analyzeSchema, { projectName: "x" }).ok).toBe(false);
    expect(
      validate(analyzeSchema, { projectName: "x", systemDescription: "y" }).ok
    ).toBe(true);
  });
  it("recusa e-mail malformado", () => {
    expect(validate(loginSchema, { email: "sem-arroba", password: "x" }).ok).toBe(false);
  });
});

describe("parsePageParams · limites", () => {
  const p = (q: string) => parsePageParams(new URLSearchParams(q));

  it("aplica os padrões", () => {
    expect(p("")).toMatchObject({ page: 1, pageSize: 20, offset: 0 });
  });
  it("limita o pageSize (evita varrer a tabela inteira)", () => {
    expect(p("pageSize=99999").pageSize).toBe(MAX_PAGE_SIZE);
  });
  it("ignora valores absurdos", () => {
    expect(p("page=-3&pageSize=0")).toMatchObject({ page: 1, pageSize: 20 });
    expect(p("page=abc").page).toBe(1);
  });
  it("calcula o offset", () => {
    expect(p("page=3&pageSize=10").offset).toBe(20);
  });
});
