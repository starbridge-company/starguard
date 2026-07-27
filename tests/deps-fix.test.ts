import { describe, it, expect } from "vitest";
import {
  canFixDependency,
  whyCannotFix,
  lockfileWarning,
  lockCommandFor,
  buildDependencyFixPrompt,
  dependencyFixTitle,
} from "@/lib/deps-fix";
import { manifestForTarget, parseTrivy } from "@/lib/parsers";
import { translate } from "@/lib/i18n/translate";
import { LOCALES } from "@/lib/i18n/config";
import type { DependencyVuln } from "@/types";

// Correção de dependência: o alvo é determinístico (o Trivy já diz o pacote e
// a versão que corrige) e a IA entra só para localizar onde editar.

function dep(p: Partial<DependencyVuln> = {}): DependencyVuln {
  return {
    id: "D-1",
    source: "sca",
    package: "lodash",
    installedVersion: "4.17.20",
    fixedVersion: "4.17.21",
    severity: "high",
    cve: "CVE-2021-23337",
    title: "Command injection em lodash",
    description: "d",
    lockfile: "package-lock.json",
    manifest: "package.json",
    ecosystem: "npm",
    ...p,
  } as DependencyVuln;
}

describe("manifestForTarget", () => {
  it("mapeia lockfile para o manifesto que se edita à mão", () => {
    expect(manifestForTarget("package-lock.json")).toBe("package.json");
    expect(manifestForTarget("yarn.lock")).toBe("package.json");
    expect(manifestForTarget("poetry.lock")).toBe("pyproject.toml");
    expect(manifestForTarget("Cargo.lock")).toBe("Cargo.toml");
    expect(manifestForTarget("go.sum")).toBe("go.mod");
  });

  it("preserva o diretório — monorepo tem vários manifestos", () => {
    expect(manifestForTarget("apps/web/package-lock.json")).toBe(
      "apps/web/package.json"
    );
  });

  it("alvo que já é manifesto passa direto", () => {
    expect(manifestForTarget("requirements.txt")).toBe("requirements.txt");
    expect(manifestForTarget("go.mod")).toBe("go.mod");
  });

  it("normaliza separador do Windows", () => {
    expect(manifestForTarget("apps\\web\\package-lock.json")).toBe(
      "apps/web/package.json"
    );
  });

  it("sem alvo, sem palpite", () => {
    expect(manifestForTarget(undefined)).toBeUndefined();
  });
});

describe("parseTrivy · localização da dependência", () => {
  it("guarda lockfile, manifesto e ecossistema", () => {
    const [d] = parseTrivy({
      Results: [
        {
          Target: "package-lock.json",
          Type: "npm",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2021-23337",
              PkgName: "lodash",
              InstalledVersion: "4.17.20",
              FixedVersion: "4.17.21",
              Severity: "HIGH",
              Title: "t",
            },
          ],
        },
      ],
    });
    expect(d!.lockfile).toBe("package-lock.json");
    expect(d!.manifest).toBe("package.json");
    expect(d!.ecosystem).toBe("npm");
  });

  it("PkgPath tem prioridade sobre Target (workspace de monorepo)", () => {
    const [d] = parseTrivy({
      Results: [
        {
          Target: "package-lock.json",
          Type: "npm",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-1",
              PkgName: "x",
              InstalledVersion: "1",
              Severity: "LOW",
              PkgPath: "apps/api/package.json",
            },
          ],
        },
      ],
    });
    expect(d!.manifest).toBe("apps/api/package.json");
  });
});

describe("canFixDependency", () => {
  it("dá para corrigir quando há versão corrigida e manifesto", () => {
    expect(canFixDependency(dep())).toBe(true);
  });

  it("sem versão corrigida NÃO oferece correção — inventar seria pior", () => {
    const d = dep({ fixedVersion: undefined });
    expect(canFixDependency(d)).toBe(false);
    expect(whyCannotFix(d)).toBe("no_fixed_version");
  });

  it("sem manifesto conhecido não há onde editar", () => {
    const d = dep({ manifest: undefined });
    expect(canFixDependency(d)).toBe(false);
    expect(whyCannotFix(d)).toBe("no_manifest");
  });

  it("corrigível não tem motivo de recusa", () => {
    expect(whyCannotFix(dep())).toBeNull();
  });
});

describe("lockfileWarning · o limite honesto", () => {
  // O agente não executa comandos (Bash está em disallowedTools). Ele edita o
  // manifesto e NÃO regera o lock — e isso quebra o `npm ci` de quem recebe.
  //
  // O aviso devolve CHAVE + valores desde o FEAT-04: ele vai para a tela E
  // para o corpo do PR, e os dois precisam sair no idioma de quem usa.
  it("avisa e diz o comando do ecossistema", () => {
    const w = lockfileWarning(dep())!;
    expect(w.key).toBe("deps.lockWarningWithCmd");
    expect(w.values).toMatchObject({
      manifest: "package.json",
      lockfile: "package-lock.json",
      cmd: "npm install",
    });
    // O texto renderizado precisa carregar os três dados, em qualquer idioma.
    for (const locale of LOCALES) {
      const texto = translate(locale, w.key, w.values);
      expect(texto).toContain("package-lock.json");
      expect(texto).toContain("npm install");
      expect(texto).not.toContain("{");
    }
  });

  it("ecossistema desconhecido ainda avisa, sem inventar comando", () => {
    const w = lockfileWarning(dep({ ecosystem: "exotico" }))!;
    expect(w.key).toBe("deps.lockWarning");
    expect(w.values).not.toHaveProperty("cmd");
    for (const locale of LOCALES) {
      const texto = translate(locale, w.key, w.values);
      expect(texto).not.toContain("undefined");
      expect(texto).not.toContain("{");
    }
    // E em português continua dizendo o que fazer sem citar comando nenhum.
    expect(translate("pt-BR", w.key, w.values)).toContain("regere o lock");
  });

  it("sem lockfile não há aviso a dar", () => {
    expect(lockfileWarning(dep({ lockfile: undefined }))).toBeNull();
  });

  it("conhece os gerenciadores mais comuns", () => {
    expect(lockCommandFor(dep({ ecosystem: "gomod" }))).toBe("go mod tidy");
    expect(lockCommandFor(dep({ ecosystem: "bundler" }))).toBe("bundle install");
  });
});

describe("buildDependencyFixPrompt", () => {
  it("fixa o alvo: pacote, versão de origem e de destino", () => {
    const p = buildDependencyFixPrompt(dep());
    expect(p).toContain("lodash");
    expect(p).toContain("4.17.20");
    expect(p).toContain("4.17.21");
    expect(p).toContain("CVE-2021-23337");
  });

  it("proíbe editar o lockfile e atualizar outras dependências", () => {
    const p = buildDependencyFixPrompt(dep());
    expect(p).toMatch(/não toque no lockfile/i);
    expect(p).toMatch(/nenhuma outra dependência/i);
  });

  it("cobre dependência transitiva, que não está no manifesto", () => {
    expect(buildDependencyFixPrompt(dep())).toMatch(/transitiva/i);
  });

  it("manda preservar a faixa de versão do arquivo", () => {
    expect(buildDependencyFixPrompt(dep())).toMatch(/\^1\.2\.3/);
  });
});

describe("dependencyFixTitle", () => {
  it("título de PR legível na lista do GitHub", () => {
    expect(dependencyFixTitle(dep())).toBe(
      "chore(deps): lodash 4.17.20 → 4.17.21 (CVE-2021-23337)"
    );
  });
});
