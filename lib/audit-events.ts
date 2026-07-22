// ============================================================
// Catálogo de eventos de auditoria — rótulos amigáveis + categorias.
// Módulo PURO (sem server-only): usado no backend (filtro por categoria) e
// no frontend (badges, cores, filtros).
// ============================================================
export type AuditCategory =
  | "auth"
  | "analise"
  | "pr"
  | "conta"
  | "usuario"
  | "sistema";

export interface EventMeta {
  label: string;
  category: AuditCategory;
}

export const EVENT_CATALOG: Record<string, EventMeta> = {
  "login.success": { label: "Login", category: "auth" },
  "login.fail": { label: "Login falho", category: "auth" },
  "login.ratelimited": { label: "Login bloqueado (limite)", category: "auth" },
  logout: { label: "Logout", category: "auth" },
  "token.refresh": { label: "Sessão renovada", category: "auth" },
  "analyze.start": { label: "Análise iniciada", category: "analise" },
  "analyze.done": { label: "Análise concluída", category: "analise" },
  "pr.open": { label: "PR aberto", category: "pr" },
  "pr.batch": { label: "PR em lote", category: "pr" },
  "token.create": { label: "Token criado", category: "conta" },
  "token.delete": { label: "Token removido", category: "conta" },
  "account.update": { label: "Conta atualizada", category: "conta" },
  "user.create": { label: "Usuário criado", category: "usuario" },
  "user.role.update": { label: "Papel alterado", category: "usuario" },
  "user.delete": { label: "Usuário excluído", category: "usuario" },
};

export const CATEGORY_META: Record<AuditCategory, { label: string }> = {
  auth: { label: "Autenticação" },
  analise: { label: "Análises" },
  pr: { label: "Pull Requests" },
  conta: { label: "Conta" },
  usuario: { label: "Usuários" },
  sistema: { label: "Sistema" },
};

export const CATEGORY_ORDER: AuditCategory[] = [
  "auth",
  "analise",
  "pr",
  "conta",
  "usuario",
  "sistema",
];

export function eventLabel(event: string): string {
  return EVENT_CATALOG[event]?.label ?? event;
}

export function eventCategory(event: string): AuditCategory {
  return EVENT_CATALOG[event]?.category ?? "sistema";
}

export function eventsForCategory(cat: string): string[] {
  return Object.keys(EVENT_CATALOG).filter(
    (e) => EVENT_CATALOG[e]!.category === cat
  );
}
