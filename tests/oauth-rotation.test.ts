// ============================================================
// Rotação de refresh e detecção de reuso — AUDITORIA.md#SEC-10.
//
// É o comportamento mais importante desta entrega, e o único que oferece
// alguma resposta a um refresh token roubado.
//
// Não dá para impedir o roubo a partir do servidor: o token vive no disco de
// quem programa. O que dá é DETECTAR o uso do que foi roubado, e a detecção
// depende inteiramente de uma regra — um token da família que já não é o
// corrente derruba a família inteira. Se ela afrouxar, a rotação vira troca
// cosmética e o roubo passa a valer trinta dias em silêncio.
//
// A regra é testada aqui na forma PURA (`decideRotation`). O que fica de fora
// é a atomicidade do `UPDATE … WHERE current_jti = $antigo`, que é do banco —
// mesma razão pela qual `lib/repos/` não tem teste de unidade neste projeto.
// Uma sessão de banco descartável fecharia essa lacuna; está declarado como
// pendência.
// ============================================================
import { describe, it, expect } from "vitest";
import { decideRotation, type SessionState } from "@/lib/oauth/rotation";

const sessao = (p: Partial<SessionState> = {}): SessionState => ({
  id: "s-1",
  userId: "u-1",
  familyId: "f-1",
  currentJti: "jti-corrente",
  revokedAt: null,
  ...p,
});

describe("uso normal", () => {
  it("o refresh CORRENTE rotaciona", () => {
    const v = decideRotation(sessao(), "jti-corrente", "jti-novo");
    expect(v.action).toBe("rotate");
    if (v.action === "rotate") expect(v.nextJti).toBe("jti-novo");
  });

  it("rotações sucessivas seguem válidas (uso por semanas)", () => {
    let corrente = "jti-0";
    for (let i = 1; i <= 20; i++) {
      const v = decideRotation(sessao({ currentJti: corrente }), corrente, `jti-${i}`);
      expect(v.action, `giro ${i}`).toBe("rotate");
      if (v.action === "rotate") corrente = v.nextJti;
    }
    expect(corrente).toBe("jti-20");
  });
});

describe("detecção de reuso — o comportamento que justifica tudo isto", () => {
  it("token da família que NÃO é o corrente derruba a família", () => {
    // O ladrão usa a cópia antiga. Assinatura válida, família conhecida, e
    // ainda assim não é o token corrente: só há duas explicações e as duas
    // pedem a mesma reação.
    const v = decideRotation(sessao({ currentJti: "jti-2" }), "jti-1", "jti-3");
    expect(v.action).toBe("revoke_family");
    if (v.action === "revoke_family") expect(v.reason).toBe("reuse_detected");
  });

  it("devolve dono e sessão, para a trilha registrar quem foi", () => {
    // Sem isto, `oauth.reuse_detected` iria para a auditoria sem dizer de quem
    // — e um alerta que não aponta ninguém não é acionável.
    const v = decideRotation(
      sessao({ id: "s-42", userId: "u-99", currentJti: "atual" }),
      "velho",
      "novo"
    );
    expect(v.action).toBe("revoke_family");
    if (v.action === "revoke_family") {
      expect(v.sessionId).toBe("s-42");
      expect(v.userId).toBe("u-99");
    }
  });

  it("um `jti` que nunca pertenceu à família também é tratado como reuso", () => {
    // Chegar aqui já significa assinatura nossa válida e família existente.
    // Um `jti` desconhecido nessa situação é um token forjado ou de outra
    // geração — nos dois casos, derrubar é a resposta.
    const v = decideRotation(sessao(), "jti-inventado", "novo");
    expect(v.action).toBe("revoke_family");
  });

  it("depois da revogação, nem o LEGÍTIMO renova", () => {
    // É o preço da detecção, e é o preço certo: entre "o ladrão continua
    // dentro" e "as duas partes fazem login de novo", só a segunda é segura.
    const revogada = sessao({ revokedAt: new Date() });
    const v = decideRotation(revogada, "jti-corrente", "novo");
    expect(v.action).toBe("reject");
    if (v.action === "reject") expect(v.reason).toBe("revoked");
  });
});

describe("sessão indisponível", () => {
  it("família inexistente é recusada", () => {
    const v = decideRotation(undefined, "qualquer", "novo");
    expect(v.action).toBe("reject");
    if (v.action === "reject") expect(v.reason).toBe("not_found");
  });

  it("sessão revogada é recusada, e o motivo NÃO é 'não encontrada'", () => {
    // A distinção importa para quem investiga: "revogada" é uma decisão que
    // alguém tomou; "não encontrada" é um token que não corresponde a nada.
    const v = decideRotation(sessao({ revokedAt: new Date() }), "jti-corrente", "novo");
    expect(v.action).toBe("reject");
    if (v.action === "reject") expect(v.reason).toBe("revoked");
  });

  it("revogada tem precedência sobre reuso", () => {
    // Numa sessão já derrubada, apresentar token velho não deve reprocessar a
    // revogação nem gerar um segundo alerta de reuso pelo mesmo incidente.
    const v = decideRotation(
      sessao({ revokedAt: new Date(), currentJti: "outro" }),
      "velho",
      "novo"
    );
    expect(v.action).toBe("reject");
  });
});

describe("famílias são independentes", () => {
  it("o veredito olha só a sessão recebida", () => {
    // Duas máquinas, dois logins. Comprometer uma não pode desconectar a
    // pessoa de todo lugar — senão a detecção vira negação de serviço.
    const a = sessao({ id: "s-a", familyId: "f-a", currentJti: "a2" });
    const b = sessao({ id: "s-b", familyId: "f-b", currentJti: "b1" });

    expect(decideRotation(a, "a1", "a3").action).toBe("revoke_family");
    expect(decideRotation(b, "b1", "b2").action).toBe("rotate");
  });
});
