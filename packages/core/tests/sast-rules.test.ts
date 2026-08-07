// ============================================================
// Onde o SAST acha as regras — AUDITORIA.md#ARQ-18.
//
// `--config auto` NÃO funciona com opengrep. Medido na versão 1.25.0: exit 2,
// stdout vazio, stderr vazio, depois de ~27 s tentando a rede. O `auto` é
// herança do Semgrep, cujo registro remoto o opengrep não implementa.
//
// E `auto` era o padrão de quem não configurasse `SAST_RULES` — o que produziu
// o sintoma mais confuso desta auditoria: o SAST funcionava no painel web (o
// Next carrega `.env.local`) e no Docker (a imagem define a variável), e
// quebrava **só na extensão do VS Code**, que não lê `.env` de projeto nenhum.
// Três produtos, um motor, e a mensagem que chegava à tela era
// `Falha no SAST: Unexpected end of JSON input`: o `JSON.parse` de uma saída
// vazia. Um erro de parser no lugar de "faltam regras".
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  limparCacheDeRegras,
  linguagensEm,
  regrasDoSast,
  regrasParaOCodigo,
  regrasUsaveis,
} from "../src/sast-rules";

const criados: string[] = [];

function dirTemporario(): string {
  const d = mkdtempSync(join(tmpdir(), "sg-regras-"));
  criados.push(d);
  return d;
}

const envAntes = { ...process.env };

beforeEach(() => limparCacheDeRegras());
afterEach(() => {
  for (const d of criados.splice(0)) rmSync(d, { recursive: true, force: true });
  process.env.SAST_RULES = envAntes.SAST_RULES;
  if (envAntes.SAST_RULES === undefined) delete process.env.SAST_RULES;
  process.env.OPENGREP_BIN = envAntes.OPENGREP_BIN;
  if (envAntes.OPENGREP_BIN === undefined) delete process.env.OPENGREP_BIN;
  limparCacheDeRegras();
});

describe("configuração explícita manda", () => {
  it("`SAST_RULES` é respeitado, e a origem diz que veio de lá", () => {
    process.env.SAST_RULES = "/um/caminho/qualquer";
    expect(regrasDoSast()).toEqual({ config: "/um/caminho/qualquer", origem: "env" });
  });

  it("…mesmo quando o caminho não existe", () => {
    // Quem apontou um caminho precisa ver o erro DAQUELE caminho. Cair em
    // silêncio para outro diretório esconderia o erro de digitação e faria a
    // pessoa depurar um scan que está lendo regras que ela não escolheu.
    process.env.SAST_RULES = "/nao/existe/mesmo";
    expect(regrasDoSast().origem).toBe("env");
  });
});

describe("detecção no disco", () => {
  it("acha o ruleset ao lado do binário", () => {
    const base = dirTemporario();
    const regras = join(base, "opengrep-rules");
    mkdirSync(join(regras, "javascript", "lang", "security"), { recursive: true });
    writeFileSync(join(regras, "javascript", "lang", "security", "r.yaml"), "rules: []");

    delete process.env.SAST_RULES;
    process.env.OPENGREP_BIN = join(base, "opengrep.exe");

    expect(regrasDoSast()).toEqual({ config: regras, origem: "detectado" });
  });

  it("desce até as regras, que não ficam na raiz do repositório", () => {
    // O erro que a primeira versão desta detecção cometeu: parar no segundo
    // nível. O `opengrep-rules` guarda por linguagem e categoria — a primeira
    // regra é `ai/csharp/detect-openai.yaml`, TRÊS níveis abaixo. Uma checagem
    // rasa concluía "não há regras aqui" com 2.021 arquivos no disco.
    const base = dirTemporario();
    const regras = join(base, "opengrep-rules");
    mkdirSync(join(regras, "ai", "csharp"), { recursive: true });
    writeFileSync(join(regras, "ai", "csharp", "detect-openai.yaml"), "rules: []");
    // Ruído no nível de cima, como no repositório real.
    writeFileSync(join(regras, "README.md"), "# regras");

    delete process.env.SAST_RULES;
    process.env.OPENGREP_BIN = join(base, "opengrep.exe");

    expect(regrasDoSast().origem).toBe("detectado");
  });

  it("diretório VAZIO não conta como ruleset", () => {
    // Um `opengrep-rules/` vazio — clone interrompido, submódulo não
    // inicializado — é pior que nenhum: o scan roda, não acha nada, e o
    // relatório parece um repositório limpo. É o UX-15 na forma mais cara.
    const base = dirTemporario();
    mkdirSync(join(base, "opengrep-rules", "javascript"), { recursive: true });

    delete process.env.SAST_RULES;
    process.env.OPENGREP_BIN = join(base, "opengrep.exe");

    expect(regrasDoSast().config).not.toContain(base);
  });

  it("sem regras em lugar nenhum, a origem é `auto` — e `auto` não serve", () => {
    const base = dirTemporario();
    delete process.env.SAST_RULES;
    // Um diretório sem nada ao lado, e um nome de binário que não leva a
    // nenhum dos lugares convencionais.
    process.env.OPENGREP_BIN = join(base, "opengrep-inexistente.exe");

    const r = regrasDoSast();
    // Nesta máquina pode haver um ruleset de verdade em `~/bin`; o que este
    // teste fixa é a EQUIVALÊNCIA entre `auto` e "não dá para escanear".
    if (r.origem === "auto") expect(regrasUsaveis()).toBe(false);
    else expect(regrasUsaveis()).toBe(true);
  });
});

describe("`auto` é indisponibilidade, não configuração", () => {
  it("com opengrep, `auto` significa que não dá para escanear", () => {
    // Rodar assim mesmo gastava 27 s para morrer sem explicação. Responder
    // "não dá, e eis o porquê" ANTES é o que separa uma ferramenta de uma
    // espera — e é a regra que o resto do produto já segue.
    process.env.SAST_RULES = "";
    const base = dirTemporario();
    process.env.OPENGREP_BIN = join(base, "sem-regras-por-perto.exe");
    limparCacheDeRegras();
    if (regrasDoSast().origem === "auto") {
      expect(regrasUsaveis()).toBe(false);
    }
  });
});

describe("o cache não engana", () => {
  it("trocar `SAST_RULES` muda a resposta", () => {
    process.env.SAST_RULES = "/primeiro";
    expect(regrasDoSast().config).toBe("/primeiro");
    process.env.SAST_RULES = "/segundo";
    // Sem invalidar à mão: a chave do cache inclui a variável, porque a
    // extensão troca essa configuração com o processo já de pé.
    expect(regrasDoSast().config).toBe("/segundo");
  });
});

// ============================================================
// Só as regras das linguagens PRESENTES — AUDITORIA.md#BUG-26
// ============================================================
//
// Medido na imagem de produção, meia CPU, os MESMOS 27 arquivos TypeScript:
//
//   ruleset inteiro (1094 regras, 11 linguagens) → 348 s
//   só javascript + typescript (181 regras)      →  65 s
//
// 5,4× de diferença, e as 913 regras descartadas — python, java, go, php,
// ruby, csharp, c, html — não têm como casar com nada num repositório
// TypeScript. Pagá-las é espera que não compra achado nenhum.
//
// O RISCO desta otimização é o relatório encolher em silêncio, que é a falta
// mais cara que esta ferramenta pode cometer (UX-15). Por isso a maioria dos
// testes abaixo é do caminho conservador: quando NÃO estreitar.
describe("estreitar o ruleset sem perder cobertura", () => {
  /** Monta um `opengrep-rules` de mentira, com uma regra em cada linguagem. */
  function rulesetFalso(langs: string[]): string {
    const base = dirTemporario();
    for (const l of langs) {
      mkdirSync(join(base, l), { recursive: true });
      writeFileSync(join(base, l, "r.yaml"), "rules: []");
    }
    return base;
  }

  /** Um projeto de mentira, com os arquivos indicados. */
  function projeto(arquivos: string[]): string {
    const base = dirTemporario();
    for (const a of arquivos) {
      const destino = join(base, a);
      mkdirSync(join(destino, ".."), { recursive: true });
      writeFileSync(destino, "// nada");
    }
    return base;
  }

  it("num repo TypeScript, entram typescript, javascript e generic", () => {
    const rules = rulesetFalso(["javascript", "typescript", "python", "java", "generic"]);
    const code = projeto(["src/a.ts", "src/b.tsx"]);

    const r = regrasParaOCodigo(rules, code);

    // `javascript` junto porque as regras de JS valem para TS — e são 163
    // contra 18. Estreitar para `typescript` puro jogaria fora a cobertura
    // real de um projeto Node.
    expect(r.linguagens).toContain("typescript");
    expect(r.linguagens).toContain("javascript");
    // `generic` SEMPRE: é onde moram segredo em código e chave privada
    // commitada, que não dependem de linguagem nenhuma.
    expect(r.linguagens).toContain("generic");
    expect(r.linguagens).not.toContain("python");
    expect(r.linguagens).not.toContain("java");
    expect(r.configs).toHaveLength(3);
  });

  it("repo poliglota recebe as regras de TODAS as linguagens que tem", () => {
    const rules = rulesetFalso(["javascript", "typescript", "python", "go", "generic"]);
    const code = projeto(["api/main.go", "scripts/x.py", "web/app.ts"]);

    const r = regrasParaOCodigo(rules, code);

    // O estreitamento nunca ESCOLHE entre linguagens presentes: só descarta as
    // ausentes.
    for (const esperada of ["go", "python", "typescript", "javascript", "generic"]) {
      expect(r.linguagens).toContain(esperada);
    }
  });

  it("ruleset que NÃO tem pastas por linguagem é devolvido inteiro", () => {
    // Diretório de regras próprio, escrito à mão. Estreitar aqui jogaria fora
    // o ruleset de quem o montou.
    const base = dirTemporario();
    writeFileSync(join(base, "minhas.yaml"), "rules: []");
    const code = projeto(["src/a.ts"]);

    const r = regrasParaOCodigo(base, code);

    expect(r.configs).toEqual([base]);
    // Vazio é o sinal de "não estreitei" — e é o que impede a tela de anunciar
    // um estreitamento que não houve.
    expect(r.linguagens).toEqual([]);
  });

  it("projeto sem linguagem reconhecida roda o ruleset INTEIRO", () => {
    const rules = rulesetFalso(["javascript", "python", "generic"]);
    const code = projeto(["dados/tabela.csv", "leia-me.txt"]);

    const r = regrasParaOCodigo(rules, code);

    // Mais lento e não perde nada — que é a direção certa de errar.
    expect(r.configs).toEqual([rules]);
    expect(r.linguagens).toEqual([]);
  });

  it("dá para desligar por variável, e aí nada muda", () => {
    const rules = rulesetFalso(["javascript", "typescript", "generic"]);
    const code = projeto(["src/a.ts"]);
    process.env.SAST_NARROW_RULES = "0";
    try {
      const r = regrasParaOCodigo(rules, code);
      expect(r.configs).toEqual([rules]);
      expect(r.linguagens).toEqual([]);
    } finally {
      delete process.env.SAST_NARROW_RULES;
    }
  });

  it("node_modules não conta como linguagem do projeto", () => {
    const rules = rulesetFalso(["javascript", "typescript", "python", "generic"]);
    const code = projeto(["src/a.ts", "node_modules/pacote/script.py"]);

    // Uma dependência com um `.py` dentro não pode arrastar 264 regras de
    // Python para um projeto que não tem Python nenhum.
    expect(regrasParaOCodigo(rules, code).linguagens).not.toContain("python");
  });

  it("linguagensEm enxerga o que existe e ignora o resto", () => {
    const code = projeto(["a.ts", "b.py", "dist/velho.go", "node_modules/x/y.java"]);
    const langs = linguagensEm(code);

    expect(langs.has("typescript")).toBe(true);
    expect(langs.has("python")).toBe(true);
    // `dist` e `node_modules` são artefato e dependência, não código de ninguém.
    expect(langs.has("go")).toBe(false);
    expect(langs.has("java")).toBe(false);
  });
});
