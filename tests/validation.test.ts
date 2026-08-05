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

  // Havia um teste de IP interno rodando DEPOIS da allowlist — inalcançável,
  // e portanto proteção nenhuma (AUDITORIA.md#BUG-18). O que barra destino
  // interno é a allowlist; este teste trava esse contrato.
  it("destino interno é barrado pela allowlist, não por regex de IP", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "169.254.169.254", // metadados de nuvem — o alvo clássico de SSRF
      "172.16.0.1",
      "[::1]",
    ]) {
      expect(parseGitHubRepo(`https://${host}/a/b`)).toBeNull();
    }
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
  const repo = "https://github.com/org/repo";

  it("exige nome do projeto", () => {
    expect(validate(analyzeSchema, { systemDescription: "y" }).ok).toBe(false);
  });

  it("recusa e-mail malformado", () => {
    expect(validate(loginSchema, { email: "sem-arroba", password: "x" }).ok).toBe(false);
  });

  // ---- Seleção AUSENTE: "rode o que der com o que eu forneci" ----
  // É o contrato de sempre, e o que as análises já gravadas usaram. Apertá-lo
  // agora quebraria quem só quer a modelagem de ameaças, sem repositório.
  describe("sem seleção explícita", () => {
    it("aceita só a descrição do sistema, sem repositório", () => {
      expect(
        validate(analyzeSchema, { projectName: "x", systemDescription: "y" }).ok
      ).toBe(true);
    });

    it("aceita só o repositório, sem descrição", () => {
      expect(validate(analyzeSchema, { projectName: "x", repoUrl: repo }).ok).toBe(true);
    });

    it("aceita só skills", () => {
      expect(
        validate(analyzeSchema, {
          projectName: "x",
          skills: [{ name: "s", content: "conteúdo" }],
        }).ok
      ).toBe(true);
    });

    it("recusa quando não há entrada NENHUMA — a análise nasceria vazia", () => {
      const r = validate(analyzeSchema, { projectName: "x" });
      expect(r.ok).toBe(false);
    });
  });

  // ---- Seleção EXPLÍCITA: a exigência acompanha o que foi pedido ----
  describe("com seleção explícita (AUDITORIA.md#ARQ-13)", () => {
    it("SÓ skills não exige descrição do sistema nem repositório", () => {
      // É o caso que motivou a reorganização: antes, validar uma skill obrigava
      // a descrever o sistema inteiro e a esperar a modelagem de ameaças.
      expect(
        validate(analyzeSchema, {
          projectName: "x",
          select: ["skills"],
          skills: [{ name: "s", content: "conteúdo" }],
        }).ok
      ).toBe(true);
    });

    it("SÓ dependências exige repositório e nada mais", () => {
      expect(
        validate(analyzeSchema, { projectName: "x", select: ["sca"], repoUrl: repo }).ok
      ).toBe(true);
      // Sem descrição do sistema — e isso está certo: o Trivy não a usa.
      expect(
        validate(analyzeSchema, { projectName: "x", select: ["sca"] }).ok
      ).toBe(false);
    });

    it("SÓ modelagem de ameaças exige descrição e dispensa repositório", () => {
      expect(
        validate(analyzeSchema, {
          projectName: "x",
          select: ["threat"],
          systemDescription: "um sistema",
        }).ok
      ).toBe(true);
      expect(
        validate(analyzeSchema, { projectName: "x", select: ["threat"] }).ok
      ).toBe(false);
    });

    it("regras de negócio exigem OS DOIS: descrição e repositório", () => {
      expect(
        validate(analyzeSchema, {
          projectName: "x",
          select: ["business"],
          systemDescription: "um sistema",
          repoUrl: repo,
        }).ok
      ).toBe(true);
      expect(
        validate(analyzeSchema, {
          projectName: "x",
          select: ["business"],
          repoUrl: repo,
        }).ok
      ).toBe(false);
    });

    it("pedir skills sem enviar skill nenhuma é recusado", () => {
      expect(
        validate(analyzeSchema, { projectName: "x", select: ["skills"] }).ok
      ).toBe(false);
    });

    it("lista vazia é recusada — não vira 'todos'", () => {
      // Rodar tudo no lugar de uma lista vazia seria fazer (e cobrar em IA)
      // algo que ninguém pediu.
      expect(
        validate(analyzeSchema, {
          projectName: "x",
          select: [],
          systemDescription: "y",
        }).ok
      ).toBe(false);
    });

    it("recusa analisador inventado", () => {
      expect(
        validate(analyzeSchema, {
          projectName: "x",
          select: ["dast"],
          repoUrl: repo,
        }).ok
      ).toBe(false);
    });

    it("o erro aponta o CAMPO que falta, não 'requisição inválida'", () => {
      const r = validate(analyzeSchema, { projectName: "x", select: ["sast"] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/repoUrl/);
    });
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
