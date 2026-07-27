"use client";

import { eventCategory, eventLabel } from "@/lib/audit-events";
import { useT, type MessageKey } from "@/lib/i18n";
import { LOCALE_COOKIE, normalizeLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";

/** Idioma ativo lido do cookie — `fmtDate` é chamada fora de componentes. */
function activeLocale(): string {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const m = document.cookie.match(new RegExp(`${LOCALE_COOKIE}=([^;]+)`));
  return normalizeLocale(m?.[1]);
}

// Peças de apresentação reutilizadas nas listagens (análises, PRs, usuários).

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Locale fixo em pt-BR era um dos quatro pontos do FEAT-04.
  return d.toLocaleString(activeLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_META: Record<string, { key: MessageKey; tone: string }> = {
  done: { key: "filter.done", tone: "ok" },
  running: { key: "filter.running", tone: "run" },
  error: { key: "filter.error", tone: "err" },
  pending: { key: "filter.queued", tone: "wait" },
};

export function StatusPill({
  status,
  progress,
}: {
  status: string;
  progress?: number;
}) {
  const t = useT();
  const meta = STATUS_META[status];
  return (
    <span className={`status-pill status-${meta?.tone ?? "wait"}`}>
      <span className="dot" />
      {meta ? t(meta.key) : status}
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
  const t = useT();
  const chips: { k: string; n: number; cls: string; label: string }[] = [
    { k: "c", n: critical, cls: "sev-critical", label: t("severity.critical") },
    { k: "h", n: high, cls: "sev-high", label: t("severity.high") },
    { k: "m", n: medium, cls: "sev-medium", label: t("severity.medium") },
    { k: "l", n: low, cls: "sev-low", label: t("severity.low") },
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
  const t = useT();
  const isSuper = role === "superadmin";
  return (
    <span className={`role-badge ${isSuper ? "role-super" : "role-admin"}`}>
      {t(isSuper ? "role.superadmin" : "role.admin")}
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
