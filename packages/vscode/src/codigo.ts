// ============================================================
// O código de autorização, de dentro do que a pessoa colou.
//
// Arquivo separado por um motivo prático: `auth.ts` importa `vscode`, que só
// existe dentro do extension host e não resolve na suíte. Regra de validação
// de entrada em fluxo de autenticação não pode ficar refém disso — é
// exatamente o tipo de coisa que precisa de teste de caminho negativo.
// ============================================================

/**
 * Aceita as três formas que aparecem na prática: o código sozinho, a URL de
 * volta inteira (`vscode://…?code=…`) e a URL copiada da barra de endereços.
 * Exigir a forma exata seria pedir edição de texto justo a quem já está
 * resolvendo um problema.
 *
 * Devolve `undefined` para tudo o mais. O formato é conferido AQUI, antes de
 * qualquer requisição: o que a pessoa tem no clipboard num momento de
 * confusão pode ser qualquer coisa — uma senha, por exemplo — e mandá-la ao
 * servidor a deixaria num log de requisição.
 */
export function extrairCodigo(bruto: string): string | undefined {
  const v = bruto.trim();
  if (!v) return undefined;

  const naQuery = v.match(/[?&]code=([A-Za-z0-9\-_]+)/)?.[1];
  if (naQuery) return ehCodigo(naQuery) ? naQuery : undefined;

  return ehCodigo(v) ? v : undefined;
}

/** 32 bytes em base64url — `randomBytes(32).toString("base64url")`. */
function ehCodigo(v: string): boolean {
  return /^[A-Za-z0-9\-_]{43}$/.test(v);
}
