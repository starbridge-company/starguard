// ============================================================
// A máquina de estados da rotação de refresh — PURA.
//
// Separada de `sessions.ts` de propósito. A regra que decide se um refresh
// vale, se é reuso, ou se a sessão já morreu é a peça mais importante desta
// entrega — é dela que depende detectar um token roubado. Enterrada dentro de
// uma consulta Drizzle, ela só seria verificável com um Postgres de pé, que é
// justamente o motivo pelo qual `lib/repos/` não tem teste de unidade neste
// projeto.
//
// Aqui a decisão é uma função de entrada para saída: dá para exercitar todos
// os caminhos, inclusive os que nunca se consegue reproduzir à mão.
//
// O que fica no SQL, e não aqui, é a ATOMICIDADE — o `UPDATE … WHERE
// current_jti = $antigo` que faz duas requisições simultâneas não gerarem duas
// rotações válidas. Isso é responsabilidade do banco e está em `sessions.ts`.
// ============================================================

/** O que a rotação precisa saber sobre a sessão. Nada de Drizzle. */
export interface SessionState {
  id: string;
  userId: string;
  familyId: string;
  /** `jti` do refresh válido AGORA. Qualquer outro da família é reuso. */
  currentJti: string;
  revokedAt: Date | null;
}

export type RotationVerdict =
  /** Segue: emite `nextJti` e invalida o anterior. */
  | { action: "rotate"; nextJti: string }
  /**
   * Token da família que já não é o corrente. Ou o legítimo repetiu (perdeu a
   * resposta), ou alguém está usando uma cópia. As duas hipóteses pedem a
   * mesma reação, porque do lado do servidor são indistinguíveis — e apostar
   * na otimista é deixar o ladrão dentro.
   */
  | { action: "revoke_family"; reason: "reuse_detected"; sessionId: string; userId: string }
  | { action: "reject"; reason: "not_found" | "revoked" };

/**
 * O refresh apresentado pode virar um novo par?
 *
 * `sessao` vem `undefined` quando a família não existe — família inventada, ou
 * banco limpo depois de um token antigo.
 */
export function decideRotation(
  sessao: SessionState | undefined,
  jtiApresentado: string,
  proximoJti: string
): RotationVerdict {
  if (!sessao) return { action: "reject", reason: "not_found" };
  if (sessao.revokedAt) return { action: "reject", reason: "revoked" };

  if (sessao.currentJti !== jtiApresentado) {
    return {
      action: "revoke_family",
      reason: "reuse_detected",
      sessionId: sessao.id,
      userId: sessao.userId,
    };
  }

  return { action: "rotate", nextJti: proximoJti };
}
