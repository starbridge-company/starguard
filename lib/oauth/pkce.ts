// ============================================================
// PKCE (RFC 7636) — o que substitui o `client_secret` num cliente público.
//
// A ideia: o cliente sorteia um segredo (`code_verifier`), manda ao servidor
// só o HASH dele (`code_challenge`) ao pedir autorização, e revela o segredo na
// hora de trocar o código por token. Quem interceptar o código no meio do
// caminho não consegue trocá-lo, porque não tem o verificador.
//
// Módulo PURO (só `node:crypto`), para a regra ter teste sem subir nada.
// ============================================================
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * `plain` NÃO é aceito.
 *
 * A RFC 7636 permite `plain` por compatibilidade com clientes antigos, e nele o
 * "desafio" é o próprio verificador em texto — ou seja, quem intercepta o
 * pedido de autorização já tem o que precisa para trocar o código. É PKCE no
 * nome e nada na prática. Nossos dois clientes são novos e nossos; não há
 * compatibilidade a preservar, então o método é um só.
 */
export type CodeChallengeMethod = "S256";

export function isS256(method: string | null | undefined): method is "S256" {
  return method === "S256";
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Verificador: 43–128 caracteres do alfabeto da RFC. 32 bytes → 43 chars. */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function deriveChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

/** O alfabeto e o tamanho da RFC 7636 §4.1. Fora disso, recusa. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidVerifier(v: string | null | undefined): boolean {
  return typeof v === "string" && VERIFIER_RE.test(v);
}

/**
 * O verificador apresentado corresponde ao desafio guardado?
 *
 * A comparação é em tempo constante. Aqui isso é menos crítico que numa senha
 * (o desafio não é segredo — o servidor o recebeu em claro), mas comparar
 * material criptográfico com `===` é o tipo de hábito que se perde no lugar
 * errado; e não custa nada.
 */
export function verifyChallenge(verifier: string, challenge: string): boolean {
  if (!isValidVerifier(verifier)) return false;
  const esperado = Buffer.from(challenge, "utf8");
  const obtido = Buffer.from(deriveChallenge(verifier), "utf8");
  if (esperado.length !== obtido.length) return false;
  return timingSafeEqual(esperado, obtido);
}

/**
 * `state` — 32 bytes aleatórios.
 *
 * Não é PKCE: PKCE amarra o CÓDIGO ao cliente; o `state` amarra a RESPOSTA ao
 * pedido. Sem ele, alguém induz a vítima a completar um fluxo de autorização
 * que o atacante começou, e a conta do atacante acaba conectada ao editor da
 * vítima — CSRF no redirect. O cliente sorteia, guarda, e confere na volta.
 */
export function generateState(): string {
  return base64url(randomBytes(32));
}
