// ============================================================
// A passagem do navegador para o aplicativo — AUDITORIA.md#SEC-10.
//
// Nasceu de um caso REAL: a tela de consentimento dizia "Autorizado", o botão
// ficava girando, e o VS Code não recebia nada. O código de autorização tinha
// sido emitido corretamente; o que falhou foi o passo seguinte, que não é do
// OAuth e sim do navegador.
//
// Abrir um esquema externo (`vscode://`) exige uma **ativação por gesto do
// usuário**. O clique em "Autorizar" dá essa ativação, mas ela não sobrevive
// ao `await` da chamada ao servidor: quando o `location.href` roda, o gesto já
// passou e o Chrome descarta a navegação **em silêncio** — sem erro no console
// da página, sem diálogo, sem nada que a pessoa possa ver.
//
// A defesa é um link de verdade, renderizado depois: clicar nele é um gesto
// NOVO. Este arquivo existe para que remover esse link volte a ser uma falha
// de suíte, e não uma tela que trava sem explicação.
//
// A verificação é sobre a FONTE porque a suíte roda em ambiente `node`, sem
// DOM. Não é o ideal — o ideal é `e2e/` — mas cobre exatamente a regressão que
// aconteceu, que é estrutural.
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagina = readFileSync(
  join(raiz, "app", "oauth", "authorize", "page.tsx"),
  "utf8"
);
const codes = readFileSync(join(raiz, "lib", "oauth", "codes.ts"), "utf8");

describe("o retorno para o aplicativo tem saída manual", () => {
  it("renderiza uma ÂNCORA para o destino, não só `location.href`", () => {
    // `<a href>` e não `<button onClick>`: o handler assíncrono já perdeu o
    // gesto, a âncora cria um novo.
    expect(pagina).toMatch(/<a\s+className="button primary"\s+href=\{destino\}>/);
  });

  it("o destino fica no estado — a tela precisa sobreviver ao redirect falho", () => {
    expect(pagina).toMatch(/const \[destino, setDestino\]/);
    expect(pagina).toContain("setDestino(alvo)");
  });

  it("o spinner PARA quando o código chega", () => {
    // O sintoma relatado foi "preso autorizando": `enviando` continuava true
    // porque o fluxo presumia que a página ia embora naquela linha.
    const corpo = pagina.slice(
      pagina.indexOf("const autorizar"),
      pagina.indexOf("const cancelar")
    );
    expect(corpo).toContain("setEnviando(false)");
  });

  it("a tela explica que pode ser preciso clicar", () => {
    // Sem isto a pessoa fica olhando para uma tela que parece concluída.
    expect(pagina).toContain("oauth.openHint");
  });

  it("o botão de autorizar não fica desabilitado para sempre", () => {
    // `disabled={enviando || pronto}` travava o botão mesmo quando o salto
    // não acontecia — sem retentativa possível.
    expect(pagina).not.toMatch(/disabled=\{enviando \|\| pronto\}/);
  });
});

describe("o código de autorização vive o bastante para um clique humano", () => {
  it("o TTL cabe nas três confirmações do caminho", () => {
    // Navegador ("abrir o Visual Studio Code?") + editor ("permitir esta
    // URI?") + a leitura de quem clica. 60 s não bastavam.
    const ms = Number(codes.match(/TTL_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ""));
    expect(ms).toBeGreaterThanOrEqual(120_000);
  });

  it("continua muito abaixo do teto da RFC 6749 §4.1.2", () => {
    // A recomendação é no máximo 10 min. Passar disso trocaria um problema de
    // usabilidade por uma janela de interceptação grande demais.
    const ms = Number(codes.match(/TTL_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ""));
    expect(ms).toBeLessThanOrEqual(600_000);
  });

  it("o texto da tela concorda com o TTL do servidor", () => {
    // Prometer "2 minutos" e expirar em 1 é pior que não prometer nada.
    expect(pagina).toContain("oauth.openExpires");
  });
});
