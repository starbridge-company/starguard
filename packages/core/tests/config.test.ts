// ============================================================
// Configuração lida NA HORA DO USO, não na carga do módulo.
//
// Isto nasceu de um defeito com sintoma enganoso na extensão do VS Code.
//
// `extension.ts` importa o núcleo na primeira linha, então `config.ts` é
// avaliado durante a ATIVAÇÃO do editor. As configurações `semgrepPath`,
// `trivyPath` e `sastRules` só são lidas depois, em `aplicarConfiguracao()`,
// que escreve em `process.env` — tarde demais para um `const` já calculado.
//
// O que a pessoa via: o painel dizia "o executável opengrep não foi encontrado
// neste computador", ela apontava o caminho na configuração (que é exatamente
// a saída que a mensagem sugere) e **nada mudava**. Sem erro e sem log: a
// configuração não existia para o motor.
//
// Não é caso de borda. Acontece em toda máquina onde o binário não está no
// PATH do processo que abriu o editor — no Windows, a regra: acrescentar
// `C:\Users\<você>\bin` ao PATH de uma sessão de terminal não muda o PATH que
// o VS Code herdou.
// ============================================================
import { describe, it, expect, afterEach } from "vitest";
import { BIN, sastConfig } from "../src/config";

const ORIGINAL = { ...process.env };

afterEach(() => {
  for (const k of ["SEMGREP_BIN", "OPENGREP_BIN", "TRIVY_BIN", "SAST_RULES"]) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe("caminho do executável (o bug da extensão)", () => {
  it("uma variável definida DEPOIS da carga do módulo vale", () => {
    // Este módulo já foi importado lá em cima — é justamente a ordem que
    // acontece no extension host.
    delete process.env.OPENGREP_BIN;
    expect(BIN.opengrep).toBe("opengrep");

    process.env.OPENGREP_BIN = "C:/ferramentas/opengrep.exe";
    expect(BIN.opengrep).toBe("C:/ferramentas/opengrep.exe");
  });

  it("vale para os três executáveis", () => {
    process.env.SEMGREP_BIN = "/opt/semgrep";
    process.env.TRIVY_BIN = "/opt/trivy";
    expect(BIN.semgrep).toBe("/opt/semgrep");
    expect(BIN.trivy).toBe("/opt/trivy");
  });

  it("APAGAR a variável volta ao padrão — dá para desfazer", () => {
    // Sem isto, apontar um binário errado uma vez seria irreversível sem
    // reiniciar o editor: `process.env` do extension host vive enquanto ele
    // viver.
    process.env.TRIVY_BIN = "/caminho/errado";
    expect(BIN.trivy).toBe("/caminho/errado");
    delete process.env.TRIVY_BIN;
    expect(BIN.trivy).toBe("trivy");
  });

  it("continua serializável — os getters são enumeráveis", () => {
    // `JSON.stringify(BIN)` aparece em diagnóstico; um getter não enumerável
    // devolveria `{}` e o doctor mentiria em silêncio.
    delete process.env.SEMGREP_BIN;
    delete process.env.OPENGREP_BIN;
    delete process.env.TRIVY_BIN;
    expect(JSON.parse(JSON.stringify(BIN))).toEqual({
      semgrep: "semgrep",
      opengrep: "opengrep",
      trivy: "trivy",
    });
  });
});

describe("ruleset do SAST", () => {
  it("o padrão é `auto` — o registro remoto", () => {
    delete process.env.SAST_RULES;
    expect(sastConfig()).toBe("auto");
  });

  it("um diretório definido depois da carga vale", () => {
    // Sem isto, quem tem as regras no disco e está sem saída para a internet
    // não conseguia rodar o SAST de jeito nenhum: `auto` baixa de semgrep.dev
    // e falha NO MEIO da análise, como erro de rede em vez de configuração
    // faltando.
    process.env.SAST_RULES = "C:/Users/alguem/bin/opengrep-rules";
    expect(sastConfig()).toBe("C:/Users/alguem/bin/opengrep-rules");
  });
});
