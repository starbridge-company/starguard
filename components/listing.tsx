"use client";

import { eventCategory, eventLabel } from "@/lib/audit-events";

// Peças de apresentação reutilizadas nas listagens (análises, PRs, usuários).

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_META: Record<
  string,
  { label: string; tone: string }
> = {
  done: { label: "Concluída", tone: "ok" },
  running: { label: "Rodando", tone: "run" },
  error: { label: "Erro", tone: "err" },
  pending: { label: "Na fila", tone: "wait" },
};

export function StatusPill({
  status,
  progress,
}: {
  status: string;
  progress?: number;
}) {
  const meta = STATUS_META[status] || { label: status, tone: "wait" };
  return (
    <span className={`status-pill status-${meta.tone}`}>
      <span className="dot" />
      {meta.label}
      {status === "running" && typeof progress === "number"
        ? ` ${progress}%`
        : ""}
    </span>
  );
}

export function SevChips({
  critical,
  high,
  medium,
  low,
}: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}) {
  const chips: { k: string; n: number; cls: string; label: string }[] = [
    { k: "c", n: critical, cls: "sev-critical", label: "crítica(s)" },
    { k: "h", n: high, cls: "sev-high", label: "alta(s)" },
    { k: "m", n: medium, cls: "sev-medium", label: "média(s)" },
    { k: "l", n: low, cls: "sev-low", label: "baixa(s)" },
  ].filter((c) => c.n > 0);

  if (chips.length === 0) return <span className="muted">—</span>;

  return (
    <span className="sev-chips">
      {chips.map((c) => (
        <span key={c.k} className={`sev-chip ${c.cls}`} title={`${c.n} ${c.label}`}>
          {c.n}
        </span>
      ))}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const isSuper = role === "superadmin";
  return (
    <span className={`role-badge ${isSuper ? "role-super" : "role-admin"}`}>
      {isSuper ? "Superadmin" : "Admin"}
    </span>
  );
}

export function AuditBadge({ event }: { event: string }) {
  return (
    <span className={`audit-badge audit-${eventCategory(event)}`}>
      {eventLabel(event)}
    </span>
  );
}
