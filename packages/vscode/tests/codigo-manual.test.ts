// ============================================================
// A saída manual do login — AUDITORIA.md#PEND-37.
//
// Existe porque a passagem do navegador para o editor depende de coisas que
// não são nossas: o registro do esquema `vscode://` no sistema, o diálogo do
// navegador e o roteamento da URI para a janela certa. Quando qualquer uma
// falha, o sintoma é sempre o mesmo — **nada acontece, e sem erro**. Colar o
// código é o caminho que não depende de nenhuma delas.
//
// O que se testa aqui é ENTRADA DE USUÁRIO num fluxo de segurança, então o
// caminho negativo pesa mais que o positivo: o que a extensão manda ao
// servidor precisa ter a forma de um código, e não qualquer coisa que a
// pessoa tenha no clipboard — uma senha, por exemplo.
// ============================================================
import { describe, it, expect } from "vitest";
import { extrairCodigo } from "../src/codigo";

/** 43 caracteres base64url — `randomBytes(32).toString("base64url")`. */
const CODIGO = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF-_";
const VALIDO = CODIGO.slice(0, 43);

describe("aceita as formas que aparecem na prática", () => {
  it("o código sozinho", () => {
    expect(extrairCodigo(VALIDO)).toBe(VALIDO);
  });

  it("com espaço em volta — copiar e colar traz isso", () => {
    expect(extrairCodigo(`  ${VALIDO}\n`)).toBe(VALIDO);
  });

  it("a URL de volta inteira", () => {
    expect(extrairCodigo(`vscode://starbridge.starguard-vscode/auth?code=${VALIDO}&state=xyz`)).toBe(
      VALIDO
    );
  });

  it("a URL com o `state` antes do `code`", () => {
    expect(extrairCodigo(`vscode://x/auth?state=xyz&code=${VALIDO}`)).toBe(VALIDO);
  });
});

describe("recusa o que não é um código", () => {
  it("vazio", () => {
    expect(extrairCodigo("")).toBeUndefined();
    expect(extrairCodigo("   ")).toBeUndefined();
  });

  it("uma senha colada por engano", () => {
    // O motivo de validar o formato ANTES de enviar: o que a pessoa tem no
    // clipboard num momento de confusão pode ser qualquer coisa, e mandá-la
    // ao servidor a deixaria num log de requisição.
    expect(extrairCodigo("minhaSenha123!")).toBeUndefined();
  });

  it("um código curto demais", () => {
    expect(extrairCodigo(VALIDO.slice(0, 20))).toBeUndefined();
  });

  it("um código longo demais", () => {
    expect(extrairCodigo(VALIDO + "aaaa")).toBeUndefined();
  });

  it("caracteres fora do alfabeto base64url", () => {
    // `+` e `/` são do base64 comum; o nosso é base64url.
    expect(extrairCodigo("a+b/c".padEnd(43, "x"))).toBeUndefined();
  });

  it("uma URL sem o parâmetro `code`", () => {
    expect(extrairCodigo("vscode://x/auth?state=xyz")).toBeUndefined();
  });

  it("uma URL cujo `code` está malformado", () => {
    expect(extrairCodigo("vscode://x/auth?code=&state=xyz")).toBeUndefined();
  });
});
