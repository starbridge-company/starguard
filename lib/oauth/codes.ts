// ============================================================
// Código de autorização — emissão e resgate.
//
// O código é a credencial mais frágil do fluxo: viaja pela barra de endereços
// do navegador, aparece em histórico e pode acabar em log de proxy. Por isso a
// defesa é em camadas, e nenhuma delas é opcional:
//
//   vida curta (60 s) · uso único · guardado hasheado ·
//   amarrado a client_id + redirect_uri + code_challenge
//
// Mesmo que ele vaze inteiro, sem o `code_verifier` não vira token.
// NODE-ONLY.
// ============================================================
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { oauthCodes } from "@/db/schema";

/** Vida do código. Curta de propósito: ele só precisa sobreviver a um redirect. */
const TTL_MS = 60_000;

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export interface IssueCodeInput {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string;
}

/** Emite o código e devolve o valor EM CLARO — o banco só guarda o hash. */
export async function issueCode(input: IssueCodeInput): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.insert(oauthCodes).values({
    codeHash: hash(code),
    userId: input.userId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope ?? null,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return code;
}

export type RedeemResult =
  | { ok: true; userId: string; scope: string | null }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "mismatch" };

/**
 * Resgata o código, se tudo casar. Uso único, garantido pelo BANCO.
 *
 * O `UPDATE … WHERE used_at IS NULL` é o ponto central: duas requisições
 * simultâneas com o mesmo código chegam ao banco, e só uma casa a condição.
 * Fazer isso com `SELECT` e depois `UPDATE` deixaria uma janela em que as duas
 * leem "não usado" e as duas emitem token — que é exatamente o que um atacante
 * de posse do código tentaria, correndo contra o cliente legítimo.
 *
 * `already_used` é distinguido de `not_found` de propósito: um código
 * apresentado duas vezes é sinal de interceptação, e quem chama audita.
 */
export async function redeemCode(opts: {
  code: string;
  clientId: string;
  redirectUri: string;
  /** Já validado contra o `code_challenge` por quem chamou. */
  challengeOk: (challenge: string) => boolean;
}): Promise<RedeemResult> {
  const codeHash = hash(opts.code);

  const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, codeHash));
  if (!row) return { ok: false, reason: "not_found" };
  if (row.usedAt) return { ok: false, reason: "already_used" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  // O código vale para o cliente e o destino com que foi emitido, e para mais
  // nenhum. Sem isto, um código obtido para o CLI serviria para a extensão.
  if (row.clientId !== opts.clientId || row.redirectUri !== opts.redirectUri) {
    return { ok: false, reason: "mismatch" };
  }
  if (!opts.challengeOk(row.codeChallenge)) return { ok: false, reason: "mismatch" };

  const marcado = await db
    .update(oauthCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.usedAt)))
    .returning({ codeHash: oauthCodes.codeHash });

  // Perdeu a corrida: outra requisição resgatou entre a leitura e a escrita.
  if (!marcado.length) return { ok: false, reason: "already_used" };

  return { ok: true, userId: row.userId, scope: row.scope };
}

/**
 * Remove códigos vencidos.
 *
 * Os usados ficam por uma hora depois de vencer, e não é desleixo: é o que
 * permite `redeemCode` responder `already_used` em vez de `not_found` quando
 * alguém reapresenta um código — a diferença entre "isto é reuso, audite" e
 * "não sei o que é isto".
 */
export async function purgeExpiredCodes(): Promise<number> {
  const res = await db
    .delete(oauthCodes)
    .where(lt(oauthCodes.expiresAt, sql`now() - interval '1 hour'`));
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
