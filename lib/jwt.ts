// ============================================================
// JWT RS256 (assimétrico) via jose — EDGE-SAFE (usado no middleware).
// Não importa argon2 nem nada Node-only. Chaves vêm da env (PEM ou base64).
// Gere-as com `npm run setup`.
// ============================================================
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";
import { JWT } from "@/lib/config";

const ALG = "RS256";

type CryptoKeyLike = Awaited<ReturnType<typeof importSPKI>>;

interface KeyCache {
  priv?: CryptoKeyLike;
  pub?: CryptoKeyLike;
}

// Cache no globalThis para sobreviver a HMR/imports repetidos.
const g = globalThis as unknown as { __sg_keys?: KeyCache };
g.__sg_keys ||= {};

function decodePem(raw: string | undefined, kind: "private" | "public"): string {
  if (!raw || !raw.trim()) {
    throw new Error(
      `JWT_${kind === "private" ? "PRIVATE" : "PUBLIC"}_KEY ausente. Rode "npm run setup".`
    );
  }
  const v = raw.trim();
  if (v.startsWith("-----BEGIN")) return v;
  // base64 -> PEM (ASCII). atob existe em edge e node modernos.
  return atob(v);
}

async function getPrivateKey(): Promise<CryptoKeyLike> {
  if (g.__sg_keys!.priv) return g.__sg_keys!.priv;
  const pem = decodePem(process.env.JWT_PRIVATE_KEY, "private");
  g.__sg_keys!.priv = await importPKCS8(pem, ALG);
  return g.__sg_keys!.priv;
}

async function getPublicKey(): Promise<CryptoKeyLike> {
  if (g.__sg_keys!.pub) return g.__sg_keys!.pub;
  const pem = decodePem(process.env.JWT_PUBLIC_KEY, "public");
  g.__sg_keys!.pub = await importSPKI(pem, ALG);
  return g.__sg_keys!.pub;
}

/**
 * Para QUEM o token foi emitido.
 *
 * `web` é o cookie do navegador; `client` é o Bearer da extensão e do CLI. São
 * públicos diferentes de propósito: um token roubado de um cookie não pode ser
 * usado como credencial de cliente, e um refresh de cliente — que dura trinta
 * dias — não pode ser plantado num cookie e virar sessão de navegador.
 *
 * Sem essa separação, o `aud` seria uma constante e as duas credenciais
 * seriam intercambiáveis, apesar de terem tempos de vida e superfícies de
 * exposição completamente diferentes.
 */
export type TokenAudience = "web" | "client";

function audienceValue(a: TokenAudience): string {
  return a === "web" ? JWT.audience : `${JWT.audience}-client`;
}

export interface SessionClaims {
  sub: string; // user id
  email: string;
  role: string;
  type: "access" | "refresh";
  jti?: string;
  /**
   * Família da sessão de cliente (rotação de refresh). Só existe em token de
   * `audience: "client"`; no cookie do navegador é `undefined`.
   */
  fam?: string;
  /** Id do cliente público que recebeu o token. */
  cid?: string;
}

async function sign(
  claims: Omit<SessionClaims, "jti">,
  ttl: string,
  jti: string,
  audience: TokenAudience = "web"
): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setIssuedAt()
    .setJti(jti)
    .setIssuer(JWT.issuer)
    .setAudience(audienceValue(audience))
    .setExpirationTime(ttl)
    .sign(key);
}

function randomJti(): string {
  return crypto.randomUUID();
}

export async function signAccessToken(
  claims: Omit<SessionClaims, "type" | "jti">,
  audience: TokenAudience = "web"
): Promise<string> {
  return sign({ ...claims, type: "access" }, JWT.accessTtl, randomJti(), audience);
}

export async function signRefreshToken(
  claims: Omit<SessionClaims, "type" | "jti">,
  jti: string,
  audience: TokenAudience = "web",
  ttl: string = JWT.refreshTtl
): Promise<string> {
  return sign({ ...claims, type: "refresh" }, ttl, jti, audience);
}

/**
 * Verifica assinatura, emissor e PÚBLICO.
 *
 * O público é parâmetro e não constante: quem chama declara qual credencial
 * espera. A rota de API que recebe um Bearer pede `client`; o middleware que lê
 * o cookie pede `web`. Deixar o padrão em `web` mantém todos os chamadores
 * existentes com o comportamento de sempre.
 */
export async function verifyToken(
  token: string,
  audience: TokenAudience = "web"
): Promise<(SessionClaims & { exp: number; iat: number }) | null> {
  try {
    const key = await getPublicKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT.issuer,
      audience: audienceValue(audience),
      algorithms: [ALG],
    });
    return payload as unknown as SessionClaims & { exp: number; iat: number };
  } catch {
    return null;
  }
}
