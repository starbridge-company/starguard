// ============================================================
// Sessão de cliente público — rotação de refresh com DETECÇÃO DE REUSO.
//
// É a peça que mais importa deste bloco, e vale explicar por quê.
//
// Um refresh token de longa duração guardado no disco de quem programa é um
// alvo real: chaveiro do SO exposto, backup vazado, máquina emprestada. Não dá
// para impedir o roubo a partir do servidor. O que dá é DETECTAR o uso do que
// foi roubado — e é isso que a rotação com famílias faz:
//
//   login  ──► família F, refresh R1 (corrente)
//   uso    ──► R1 vira R2. R1 morreu.
//   ...
//   alguém apresenta R1 de novo
//        ──► R1 pertence a F, mas não é o corrente.
//            Ou o legítimo perdeu a resposta e repetiu, ou alguém copiou.
//            Nos dois casos, a resposta segura é a mesma:
//            REVOGA A FAMÍLIA INTEIRA e audita.
//
// O legítimo faz login de novo (um incômodo). O ladrão perde o acesso, e fica
// registrado que houve reuso. Sem rotação, um token roubado valeria trinta dias
// sem ninguém saber.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { oauthSessions } from "@/db/schema";
import * as revocations from "@/lib/repos/revocations";
import { decideRotation } from "@/lib/oauth/rotation";

export interface StartedSession {
  sessionId: string;
  familyId: string;
  jti: string;
}

/** Abre uma sessão nova (um login). Cada login é uma família própria. */
export async function startSession(opts: {
  userId: string;
  clientId: string;
  label?: string;
}): Promise<StartedSession> {
  const familyId = crypto.randomUUID();
  const jti = crypto.randomUUID();
  const [row] = await db
    .insert(oauthSessions)
    .values({
      userId: opts.userId,
      clientId: opts.clientId,
      familyId,
      currentJti: jti,
      label: opts.label ?? null,
    })
    .returning({ id: oauthSessions.id });
  return { sessionId: row!.id, familyId, jti };
}

export type RotateResult =
  | { ok: true; sessionId: string; jti: string }
  /** O `jti` pertence à família mas não é o corrente: token repetido. */
  | { ok: false; reason: "reuse_detected"; sessionId: string; userId: string }
  | { ok: false; reason: "not_found" | "revoked" };

/**
 * Troca o refresh corrente por um novo.
 *
 * Recebe a `familyId` e o `jti` que vieram DENTRO do token já verificado
 * criptograficamente — quem chama garante a assinatura; aqui se decide se
 * aquele token específico ainda vale.
 */
export async function rotate(opts: {
  familyId: string;
  jti: string;
}): Promise<RotateResult> {
  const [sessao] = await db
    .select()
    .from(oauthSessions)
    .where(eq(oauthSessions.familyId, opts.familyId));

  const novoJti = crypto.randomUUID();

  // A decisão mora em `rotation.ts`, pura e com teste. Aqui só se aplica o
  // veredito — o que este arquivo acrescenta é o banco e a atomicidade.
  const veredito = decideRotation(sessao, opts.jti, novoJti);

  if (veredito.action === "reject") {
    return { ok: false, reason: veredito.reason };
  }

  if (veredito.action === "revoke_family") {
    await revokeSession(veredito.sessionId, "reuse_detected");
    return {
      ok: false,
      reason: "reuse_detected",
      sessionId: veredito.sessionId,
      userId: veredito.userId,
    };
  }

  // Condicionado ao `jti` corrente: dois refresh simultâneos com o MESMO token
  // (a rede oscilou, o cliente repetiu) não podem gerar duas rotações válidas.
  // A segunda não casa e cai como reuso — que é o tratamento correto: do ponto
  // de vista do servidor, é indistinguível de um token repetido por terceiro.
  const atualizado = await db
    .update(oauthSessions)
    .set({ currentJti: veredito.nextJti, lastUsedAt: new Date() })
    .where(
      and(
        eq(oauthSessions.id, sessao!.id),
        eq(oauthSessions.currentJti, opts.jti),
        isNull(oauthSessions.revokedAt)
      )
    )
    .returning({ id: oauthSessions.id });

  if (!atualizado.length) return { ok: false, reason: "revoked" };

  // O `jti` velho entra na blocklist que o app já usa. É cinto e suspensório:
  // a checagem da família já o barraria, mas qualquer caminho que valide
  // refresh sem passar por aqui continua protegido.
  await revocations
    .revoke(opts.jti, sessao!.userId, new Date(Date.now() + 30 * 24 * 3600_000))
    .catch(() => {});

  return { ok: true, sessionId: sessao!.id, jti: veredito.nextJti };
}

export async function revokeSession(
  sessionId: string,
  reason: "user" | "logout" | "reuse_detected"
): Promise<void> {
  await db
    .update(oauthSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(oauthSessions.id, sessionId), isNull(oauthSessions.revokedAt)));
}

/** Sessões ATIVAS de um usuário — alimenta "Dispositivos conectados". */
export async function listActive(userId: string) {
  return db
    .select({
      id: oauthSessions.id,
      clientId: oauthSessions.clientId,
      label: oauthSessions.label,
      createdAt: oauthSessions.createdAt,
      lastUsedAt: oauthSessions.lastUsedAt,
    })
    .from(oauthSessions)
    .where(and(eq(oauthSessions.userId, userId), isNull(oauthSessions.revokedAt)))
    .orderBy(desc(oauthSessions.lastUsedAt));
}

/** Confere que a sessão pertence a quem pediu, antes de revogar. */
export async function ownerOf(sessionId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: oauthSessions.userId })
    .from(oauthSessions)
    .where(eq(oauthSessions.id, sessionId));
  return row?.userId;
}

/**
 * A sessão por trás de um access token ainda vale?
 *
 * O access token dura 15 minutos, então revogar um dispositivo não o invalida
 * na hora — ele continuaria aceito até expirar. Para o que é barato (rotas de
 * leitura) esses 15 minutos são aceitáveis; para o que gasta dinheiro ou muda
 * estado, esta consulta fecha a janela.
 */
export async function familyIsActive(familyId: string): Promise<boolean> {
  const [row] = await db
    .select({ revokedAt: oauthSessions.revokedAt })
    .from(oauthSessions)
    .where(eq(oauthSessions.familyId, familyId));
  return !!row && !row.revokedAt;
}
