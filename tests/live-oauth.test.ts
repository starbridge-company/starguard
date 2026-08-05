// ============================================================
// OAuth contra o Postgres REAL — AUDITORIA.md#PEND-38 e #PEND-39.
//
// Roda por `npm run test:live`, fora do `npm test`, porque precisa de banco.
//
// O que só aqui se prova, e por isso este arquivo existe: a **atomicidade**.
// A regra de decisão da rotação é pura e já tem teste (`oauth-rotation.test.ts`);
// o que nenhum teste de unidade alcança é o `UPDATE … WHERE used_at IS NULL` e
// o `UPDATE … WHERE current_jti = $antigo`, que são o que impede duas
// requisições simultâneas de resgatarem o mesmo código ou de gerarem duas
// rotações válidas. Isso é comportamento do Postgres, não do TypeScript.
//
// Limpa o que cria: as linhas de teste saem no fim, e nenhuma conta é tocada.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { oauthCodes, oauthSessions, users } from "@/db/schema";
import { issueCode, redeemCode } from "@/lib/oauth/codes";
import { startSession, rotate, revokeSession, familyIsActive, listActive } from "@/lib/oauth/sessions";
import { deriveChallenge, generateCodeVerifier } from "@/lib/oauth/pkce";

const CLIENT = "starguard-cli";
const REDIRECT = "http://127.0.0.1:51000/callback";

/** Usuário existente qualquer — a FK exige um real; nada nele é alterado. */
let userId = "";
const familiasCriadas: string[] = [];

beforeAll(async () => {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error("Nenhum usuário no banco — rode `npm run db:seed` antes.");
  userId = u.id;
});

afterAll(async () => {
  // Sai tudo o que este arquivo criou. Um teste que suja o banco de quem o
  // roda é pior que teste nenhum.
  if (familiasCriadas.length) {
    await db.delete(oauthSessions).where(inArray(oauthSessions.familyId, familiasCriadas));
  }
  await db.delete(oauthCodes).where(eq(oauthCodes.userId, userId));
});

async function novoCodigo(verifier: string) {
  return issueCode({
    userId,
    clientId: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: deriveChallenge(verifier),
  });
}

describe("código de autorização, contra o banco real", () => {
  it("emite, guarda HASHEADO e resgata com o verificador certo", async () => {
    const verifier = generateCodeVerifier();
    const code = await novoCodigo(verifier);

    // O que está na tabela não pode ser o código: um dump não pode render
    // credencial utilizável.
    const linhas = await db.select().from(oauthCodes).where(eq(oauthCodes.userId, userId));
    expect(linhas.some((l) => l.codeHash === code)).toBe(false);

    const r = await redeemCode({
      code,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      challengeOk: (ch) => ch === deriveChallenge(verifier),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe(userId);
  });

  it("USO ÚNICO — a segunda tentativa é recusada como reuso", async () => {
    const verifier = generateCodeVerifier();
    const code = await novoCodigo(verifier);
    const ok = { code, clientId: CLIENT, redirectUri: REDIRECT, challengeOk: () => true };

    expect((await redeemCode(ok)).ok).toBe(true);
    const segunda = await redeemCode(ok);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.reason).toBe("already_used");
  });

  it("ATOMICIDADE: dez resgates SIMULTÂNEOS, só um vence", async () => {
    // É o teste que justifica este arquivo. Com `SELECT` antes do `UPDATE`
    // haveria uma janela em que várias requisições leem "não usado" e todas
    // emitem token — exatamente o que um atacante de posse do código tentaria,
    // correndo contra o cliente legítimo.
    const verifier = generateCodeVerifier();
    const code = await novoCodigo(verifier);
    const tentativa = () =>
      redeemCode({ code, clientId: CLIENT, redirectUri: REDIRECT, challengeOk: () => true });

    const resultados = await Promise.all(Array.from({ length: 10 }, tentativa));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toHaveLength(9);
  });

  it("recusa client_id divergente do que emitiu", async () => {
    const code = await novoCodigo(generateCodeVerifier());
    const r = await redeemCode({
      code,
      clientId: "starguard-vscode",
      redirectUri: REDIRECT,
      challengeOk: () => true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("mismatch");
  });

  it("recusa redirect_uri divergente", async () => {
    const code = await novoCodigo(generateCodeVerifier());
    const r = await redeemCode({
      code,
      clientId: CLIENT,
      redirectUri: "http://127.0.0.1:9999/callback",
      challengeOk: () => true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("mismatch");
  });

  it("recusa verificador que não casa com o desafio", async () => {
    const code = await novoCodigo(generateCodeVerifier());
    const r = await redeemCode({
      code,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      challengeOk: () => false,
    });
    expect(r.ok).toBe(false);
  });

  it("código inexistente é `not_found`, não erro", async () => {
    const r = await redeemCode({
      code: "nunca-existiu",
      clientId: CLIENT,
      redirectUri: REDIRECT,
      challengeOk: () => true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_found");
  });
});

describe("sessão e rotação, contra o banco real", () => {
  async function login() {
    const s = await startSession({ userId, clientId: CLIENT, label: "teste ao vivo" });
    familiasCriadas.push(s.familyId);
    return s;
  }

  it("abre a sessão e rotaciona", async () => {
    const s = await login();
    const r = await rotate({ familyId: s.familyId, jti: s.jti });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.jti).not.toBe(s.jti);
  });

  it("REUSO derruba a família — e fica gravado o motivo", async () => {
    const s = await login();
    await rotate({ familyId: s.familyId, jti: s.jti });

    const reuso = await rotate({ familyId: s.familyId, jti: s.jti });
    expect(reuso.ok).toBe(false);
    if (!reuso.ok) expect(reuso.reason).toBe("reuse_detected");

    const [linha] = await db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.familyId, s.familyId));
    expect(linha!.revokedAt).not.toBeNull();
    expect(linha!.revokedReason).toBe("reuse_detected");
    expect(await familyIsActive(s.familyId)).toBe(false);
  });

  it("ATOMICIDADE: dez rotações simultâneas do MESMO token, só uma vence", async () => {
    // A rede oscila e o cliente repete; ou alguém copiou o token. Do lado do
    // servidor são indistinguíveis, e o `UPDATE` condicionado ao `jti` corrente
    // é o que garante que apenas uma passe.
    const s = await login();
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => rotate({ familyId: s.familyId, jti: s.jti }))
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  });

  it("sessão revogada pela pessoa não renova mais", async () => {
    const s = await login();
    const [linha] = await db
      .select({ id: oauthSessions.id })
      .from(oauthSessions)
      .where(eq(oauthSessions.familyId, s.familyId));

    await revokeSession(linha!.id, "user");
    const r = await rotate({ familyId: s.familyId, jti: s.jti });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked");
  });

  it("`listActive` mostra só as vivas — é o que a tela de Conta lê", async () => {
    const viva = await login();
    const morta = await login();
    const [linhaMorta] = await db
      .select({ id: oauthSessions.id })
      .from(oauthSessions)
      .where(eq(oauthSessions.familyId, morta.familyId));
    await revokeSession(linhaMorta!.id, "user");

    const ativas = await listActive(userId);
    const ids = ativas.map((a) => a.id);
    expect(ids).toContain(
      (
        await db
          .select({ id: oauthSessions.id })
          .from(oauthSessions)
          .where(eq(oauthSessions.familyId, viva.familyId))
      )[0]!.id
    );
    expect(ids).not.toContain(linhaMorta!.id);
  });

  it("famílias são independentes: reuso numa não derruba a outra", async () => {
    const a = await login();
    const b = await login();

    await rotate({ familyId: a.familyId, jti: a.jti });
    await rotate({ familyId: a.familyId, jti: a.jti }); // reuso em A

    expect(await familyIsActive(a.familyId)).toBe(false);
    expect(await familyIsActive(b.familyId)).toBe(true);
  });
});
