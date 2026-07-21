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

export interface SessionClaims {
  sub: string; // user id
  email: string;
  role: string;
  type: "access" | "refresh";
  jti?: string;
}

async function sign(
  claims: Omit<SessionClaims, "jti">,
  ttl: string,
  jti: string
): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setIssuedAt()
    .setJti(jti)
    .setIssuer(JWT.issuer)
    .setAudience(JWT.audience)
    .setExpirationTime(ttl)
    .sign(key);
}

function randomJti(): string {
  return crypto.randomUUID();
}

export async function signAccessToken(
  claims: Omit<SessionClaims, "type" | "jti">
): Promise<string> {
  return sign({ ...claims, type: "access" }, JWT.accessTtl, randomJti());
}

export async function signRefreshToken(
  claims: Omit<SessionClaims, "type" | "jti">,
  jti: string
): Promise<string> {
  return sign({ ...claims, type: "refresh" }, JWT.refreshTtl, jti);
}

export async function verifyToken(
  token: string
): Promise<(SessionClaims & { exp: number; iat: number }) | null> {
  try {
    const key = await getPublicKey();
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT.issuer,
      audience: JWT.audience,
      algorithms: [ALG],
    });
    return payload as unknown as SessionClaims & { exp: number; iat: number };
  } catch {
    return null;
  }
}
