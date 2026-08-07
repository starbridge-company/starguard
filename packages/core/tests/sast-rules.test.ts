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
import { limparCacheDeRegras, regrasDoSast, regrasUsaveis } from "../src/sast-rules";

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
