// ============================================================
// Criptografia simétrica dos tokens do GitHub — AES-256-GCM. NODE-ONLY.
// Chave em TOKEN_ENC_KEY (base64 de 32 bytes; gerada por scripts/gen-keys.mjs).
// Guardamos ciphertext + iv + authTag (base64); o plaintext só existe em
// memória no servidor no instante do uso. Nunca volta ao cliente.
// ============================================================
import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALG = "aes-256-gcm";
const IV_BYTES = 12; // recomendado para GCM

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw || !raw.trim()) {
    throw new Error(
      'TOKEN_ENC_KEY ausente. Rode "npm run setup" para gerá-la no .env.local.'
    );
  }
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENC_KEY inválida: precisa ser base64 de exatamente 32 bytes."
    );
  }
  cachedKey = key;
  return key;
}

export interface EncryptedToken {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptToken(plain: string): EncryptedToken {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptToken(t: EncryptedToken): string {
  const decipher = createDecipheriv(
    ALG,
    getKey(),
    Buffer.from(t.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(t.authTag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(t.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Últimos 4 caracteres do token, para exibição segura (nunca o token inteiro). */
export function last4(token: string): string {
  const t = token.trim();
  return t.length <= 4 ? t : t.slice(-4);
}
