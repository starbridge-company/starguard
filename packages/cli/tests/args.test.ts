// ============================================================
// Argumentos do `starguard` — AUDITORIA.md#ARQ-13.
//
// Duas coisas aqui não são detalhe: o erro de digitação em `--only` e os
// códigos de saída.
//
// `--only semgrep` (o nome do binário, não do analisador) é o engano mais
// provável de todos. Descartá-lo em silêncio devolveria uma análise COMPLETA a
// quem pediu uma parcial — mais lenta, mais cara, e com a conclusão errada de
// que a flag não funciona.
//
// O código de saída é o que torna o comando utilizável em CI, e a distinção
// entre "achei problemas" (1) e "não consegui rodar" (2) é a que permite um
// pipeline reagir diferente a cada caso.
// ============================================================
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atingeLimiar,
  comConfig,
  lerConfig,
  parse,
  ErroDeUso,
  SAIDA,
} from "../src/args";

describe("comando e alvo", () => {
  it("sem comando, é `scan` no diretório atual", () => {
    const op = parse([]);
    expect(op.comando).toBe("scan");
    expect(op.alvo).toBe(".");
  });

  it("`scan <caminho>` usa o caminho como alvo", () => {
    expect(parse(["scan", "./projeto"]).alvo).toBe("./projeto");
  });

  it("`scan <url>` também é alvo — o núcleo decide se clona ou abre em disco", () => {
    expect(parse(["scan", "https://github.com/org/repo"]).alvo).toBe(
      "https://github.com/org/repo"
    );
  });

  it("no `skills`, os argumentos livres são ARQUIVOS, não alvo", () => {
    const op = parse(["skills", "a.md", "b.md"]);
    expect(op.alvo).toBe(".");
    expect(op.resto).toEqual(["a.md", "b.md"]);
  });

  it("`skills` é atalho para --only skills", () => {
    expect(parse(["skills", "a.md"]).select).toEqual(["skills"]);
  });

  it("--only explícito ganha do atalho do comando", () => {
    expect(parse(["skills", "a.md", "--only", "sast"]).select).toEqual(["sast"]);
  });
});

describe("--only e --skip", () => {
  it("aceita lista separada por vírgula", () => {
    expect(parse(["scan", "--only", "sast,sca"]).select).toEqual(["sast", "sca"]);
  });

  it("aceita a flag repetida", () => {
    expect(parse(["scan", "--only", "sast", "--only", "sca"]).select).toEqual([
      "sast",
      "sca",
    ]);
  });

  it("remove repetição", () => {
    expect(parse(["scan", "--only", "sca,sca"]).select).toEqual(["sca"]);
  });

  it("--skip devolve o complemento", () => {
    const sel = parse(["scan", "--skip", "business,threat"]).select!;
    expect(sel).not.toContain("business");
    expect(sel).not.toContain("threat");
    expect(sel).toContain("sast");
  });

  it("--only e --skip juntos são recusados", () => {
    expect(() => parse(["scan", "--only", "sast", "--skip", "sca"])).toThrow(ErroDeUso);
  });

  it("RECUSA analisador desconhecido em vez de ignorar", () => {
    // `--only semgrep` é o engano mais provável: é o nome do binário, não o do
    // analisador. Silenciar devolveria a análise completa a quem pediu uma
    // parcial.
    expect(() => parse(["scan", "--only", "semgrep"])).toThrow(/semgrep/);
    expect(() => parse(["scan", "--only", "sast,inventado"])).toThrow(/inventado/);
  });

  it("a mensagem de erro lista os analisadores válidos", () => {
    expect(() => parse(["scan", "--only", "xpto"])).toThrow(/sast/);
  });

  it("sem --only nem --skip, a seleção fica indefinida (= todos)", () => {
    expect(parse(["scan"]).select).toBeUndefined();
  });
});

describe("--fail-on e --severity", () => {
  it("aceita as severidades conhecidas", () => {
    expect(parse(["scan", "--fail-on", "high"]).failOn).toBe("high");
    expect(parse(["scan", "--fail-on", "CRITICAL"]).failOn).toBe("critical");
  });

  it("recusa severidade inventada", () => {
    expect(() => parse(["scan", "--fail-on", "urgente"])).toThrow(/urgente/);
  });

  it("atingeLimiar compara pela gravidade, não pela ordem alfabética", () => {
    expect(atingeLimiar("critical", "high")).toBe(true);
    expect(atingeLimiar("high", "high")).toBe(true);
    expect(atingeLimiar("medium", "high")).toBe(false);
    expect(atingeLimiar("info", "low")).toBe(false);
  });
});

describe("demais flags", () => {
  it("--json, --sarif, --no-ai, --write, --dry-run, --all", () => {
    const op = parse([
      "scan",
      "--json",
      "--sarif",
      "out.sarif",
      "--no-ai",
      "--write",
      "--dry-run",
      "--all",
    ]);
    expect(op.json).toBe(true);
    expect(op.sarif).toBe("out.sarif");
    expect(op.noAi).toBe(true);
    expect(op.write).toBe(true);
    expect(op.dryRun).toBe(true);
    expect(op.all).toBe(true);
  });

  it("--lang normaliza variantes regionais", () => {
    expect(parse(["scan", "--lang", "es-AR"]).locale).toBe("es");
    expect(parse(["scan", "--lang", "pt"]).locale).toBe("pt-BR");
    expect(parse(["scan"]).locale).toBe("pt-BR");
  });

  it("-h e -v têm precedência sobre o comando", () => {
    expect(parse(["scan", "-h"]).comando).toBe("help");
    expect(parse(["doctor", "-v"]).comando).toBe("version");
  });

  it("flag desconhecida é erro, não silêncio", () => {
    expect(() => parse(["scan", "--inventada"])).toThrow();
  });
});

describe(".starguard.json", () => {
  it("ausente é o caso normal, não erro", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sg-cfg-"));
    expect(await lerConfig(dir)).toEqual({});
    await rm(dir, { recursive: true, force: true });
  });

  it("JSON quebrado é ERRO — silenciá-lo faria a configuração não pegar sem motivo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sg-cfg-"));
    await writeFile(join(dir, ".starguard.json"), "{ isto não é json");
    await expect(lerConfig(dir)).rejects.toThrow(ErroDeUso);
    await rm(dir, { recursive: true, force: true });
  });

  it("preenche o que a flag não disse", () => {
    const op = comConfig(parse(["scan"]), { select: ["sca"], failOn: "high" });
    expect(op.select).toEqual(["sca"]);
    expect(op.failOn).toBe("high");
  });

  it("a FLAG ganha do arquivo — quem digitou agora está mais certo", () => {
    const op = comConfig(parse(["scan", "--only", "sast", "--fail-on", "low"]), {
      select: ["sca"],
      failOn: "critical",
    });
    expect(op.select).toEqual(["sast"]);
    expect(op.failOn).toBe("low");
  });

  it("`skip` no arquivo também vira seleção", () => {
    const op = comConfig(parse(["scan"]), { skip: ["business"] });
    expect(op.select).not.toContain("business");
    expect(op.select).toContain("sca");
  });

  it("descarta analisador inválido vindo do arquivo sem derrubar o comando", () => {
    // O arquivo pode ter sido escrito para uma versão anterior; recusar o
    // comando inteiro por causa disso seria pior que ignorar a entrada morta.
    const op = comConfig(parse(["scan"]), { select: ["sca", "dast"] });
    expect(op.select).toEqual(["sca"]);
  });
});

describe("códigos de saída", () => {
  it("são três, e distintos", () => {
    // Um pipeline que trata qualquer não-zero como quebra continua
    // funcionando; um que quer distinguir "achei problemas" de "não consegui
    // rodar" consegue.
    expect(SAIDA.limpo).toBe(0);
    expect(SAIDA.achados).toBe(1);
    expect(SAIDA.erro).toBe(2);
  });
});
