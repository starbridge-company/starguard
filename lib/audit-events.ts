// ============================================================
// Catálogo de eventos de auditoria — categorias + chave de tradução.
// Módulo PURO (sem server-only): usado no backend (filtro por categoria) e
// no frontend (badges, cores, filtros).
//
// Os rótulos eram literais em português aqui dentro: a tela de monitoramento
// aparecia meio traduzida para quem lê em inglês. É a frente "enums de
// domínio" do FEAT-04 — ver AUDITORIA.md#PEND-23. O módulo continua puro:
// guarda a CHAVE, e quem renderiza aplica o `t()`.
// ============================================================
export type AuditCategory =
  | "auth"
  | "analise"
  | "pr"
  | "conta"
  | "usuario"
  | "sistema";

export interface EventMeta {
  category: AuditCategory;
}

/**
 * A chave de tradução é derivada do nome do evento (`auditEvent.<evento>`),
 * não repetida entrada por entrada: uma tabela paralela de chaves seria só
 * mais um lugar para sair de sincronia.
 */
export const EVENT_CATALOG: Record<string, EventMeta> = {
  "login.success": { category: "auth" },
  "login.fail": { category: "auth" },
  "login.ratelimited": { category: "auth" },
  logout: { category: "auth" },
  "token.refresh": { category: "auth" },
  "session.revoked": { category: "auth" },
  "analyze.start": { category: "analise" },
  "finding.status": { category: "analise" },
  "fix.generate": { category: "analise" },
  "fix.cached": { category: "analise" },
  "analyze.done": { category: "analise" },
  "analysis.delete": { category: "analise" },
  "analysis.export": { category: "analise" },
  "pr.open": { category: "pr" },
  "pr.batch": { category: "pr" },
  "token.create": { category: "conta" },
  "token.delete": { category: "conta" },
  "account.update": { category: "conta" },
  "user.create": { category: "usuario" },
  "user.role.update": { category: "usuario" },
  "user.delete": { category: "usuario" },
  // ---- OAuth de cliente público (extensão do VS Code, CLI) ----
  "oauth.authorize": { category: "auth" },
  "oauth.token": { category: "auth" },
  "oauth.refresh": { category: "auth" },
  "oauth.revoke": { category: "auth" },
  // Os dois eventos que valem alarme, e por isso têm nome próprio em vez de
  // sumirem dentro de um "falha de login": os dois significam que uma
  // credencial foi apresentada por quem não deveria tê-la.
  "oauth.code_reuse": { category: "auth" },
  "oauth.reuse_detected": { category: "auth" },
};

export const CATEGORY_ORDER: AuditCategory[] = [
  "auth",
  "analise",
  "pr",
  "conta",
  "usuario",
  "sistema",
];

/** Chave de tradução do evento. Evento desconhecido devolve `null` — quem
 *  renderiza mostra o nome cru, que é mais útil que um rótulo genérico. */
export function eventLabelKey(event: string): string | null {
  return EVENT_CATALOG[event] ? `auditEvent.${event}` : null;
}

export function eventCategory(event: string): AuditCategory {
  return EVENT_CATALOG[event]?.category ?? "sistema";
}

export function eventsForCategory(cat: string): string[] {
  return Object.keys(EVENT_CATALOG).filter(
    (e) => EVENT_CATALOG[e]!.category === cat
  );
}
