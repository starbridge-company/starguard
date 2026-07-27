"use client";

// Componentes de filtro personalizados, no visual do site e responsivos:
// busca, controle segmentado, faixa de datas (com presets) e seletor de
// usuário/ papel via popover próprio (sem <select> nativo).
import { useEffect, useRef, useState } from "react";
import {
  IconSearch,
  IconX,
  IconCalendar,
  IconChevronDown,
  IconUser,
  IconCheck,
} from "@/lib/icons";
import { RoleBadge } from "@/components/listing";
import { useT } from "@/lib/i18n";

// ---- Hook de dropdown (abre/fecha, clique-fora, ESC) ----
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// ---- Busca ----
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useT();
  return (
    <div className="flt-search">
      <IconSearch />
      <input
        className="flt-search-input"
        placeholder={placeholder || t("filter.search")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="flt-search-clear"
          aria-label={t("filter.clearSearch")}
          onClick={() => onChange("")}
        >
          <IconX />
        </button>
      )}
    </div>
  );
}

// ---- Controle segmentado (pills) ----
export interface SegOption {
  value: string;
  label: string;
}
export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`seg-btn ${value === o.value ? "active" : ""}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Faixa de datas com presets ----
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function short(v: string): string {
  if (!v) return "";
  const [y, m, d] = v.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const t = useT();
  const { open, setOpen, ref } = useDropdown();

  const label =
    !from && !to
      ? t("filter.anyDate")
      : from && to
        ? from === to
          ? short(from)
          : `${short(from)} – ${short(to)}`
        : from
          ? `desde ${short(from)}`
          : `até ${short(to)}`;

  const presets: { label: string; get: () => [string, string] }[] = [
    { label: t("filter.anyDate"), get: (): [string, string] => ["", ""] },
    { label: t("filter.today"), get: (): [string, string] => [ymd(new Date()), ymd(new Date())] },
    { label: t("filter.last7"), get: (): [string, string] => [ymd(daysAgo(6)), ymd(new Date())] },
    { label: t("filter.last30"), get: (): [string, string] => [ymd(daysAgo(29)), ymd(new Date())] },
  ];

  const active = !!from || !!to;

  return (
    <div className="flt-dd" ref={ref}>
      <button
        type="button"
        className={`flt-trigger ${active ? "has-value" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconCalendar />
        <span className="flt-trigger-label">{label}</span>
        <IconChevronDown className="flt-caret" />
      </button>
      {open && (
        <div className="flt-pop">
          <div className="flt-pop-title">{t("filter.period")}</div>
          <div className="date-presets">
            {presets.map((p) => {
              const [pf, pt] = p.get();
              const isActive = pf === from && pt === to;
              return (
                <button
                  key={p.label}
                  type="button"
                  className={`preset-btn ${isActive ? "active" : ""}`}
                  onClick={() => {
                    onChange(pf, pt);
                    setOpen(false);
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flt-pop-sep" />
          <div className="date-custom">
            <label>
              <span>{t("filter.from")}</span>
              <input
                type="date"
                className="input date-input"
                value={from}
                max={to || undefined}
                onChange={(e) => onChange(e.target.value, to)}
              />
            </label>
            <label>
              <span>{t("filter.to")}</span>
              <input
                type="date"
                className="input date-input"
                value={to}
                min={from || undefined}
                onChange={(e) => onChange(from, e.target.value)}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Seletor de usuário (com busca) ----
export interface UserOption {
  id: string;
  name: string;
  email: string;
}
export function UserSelect({
  users,
  value,
  onChange,
}: {
  users: UserOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const { open, setOpen, ref } = useDropdown();
  const [q, setQ] = useState("");
  const selected = users.find((u) => u.id === value);
  const filtered = q.trim()
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(q.toLowerCase()) ||
          u.email.toLowerCase().includes(q.toLowerCase())
      )
    : users;

  return (
    <div className="flt-dd" ref={ref}>
      <button
        type="button"
        className={`flt-trigger ${value ? "has-value" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconUser />
        <span className="flt-trigger-label">
          {selected ? selected.name : t("filter.allUsers")}
        </span>
        <IconChevronDown className="flt-caret" />
      </button>
      {open && (
        <div className="flt-pop flt-pop-wide">
          <div className="flt-search sm">
            <IconSearch />
            <input
              className="flt-search-input"
              placeholder={t("filter.filterUsers")}
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flt-options">
            <button
              type="button"
              className={`flt-option ${!value ? "active" : ""}`}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <span className="flt-option-main">{t("filter.allUsers")}</span>
              {!value && <IconCheck />}
            </button>
            {filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                className={`flt-option ${value === u.id ? "active" : ""}`}
                onClick={() => {
                  onChange(u.id);
                  setOpen(false);
                }}
              >
                <span className="flt-option-main">
                  {u.name}
                  <span className="flt-option-sub">{u.email}</span>
                </span>
                {value === u.id && <IconCheck />}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="flt-empty">{t("filter.noUsers")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Seletor de papel (mutação inline na tabela de usuários) ----
const ROLE_OPTS: { value: "admin" | "superadmin"; desc: string }[] = [
  { value: "admin", desc: "Vê apenas o próprio histórico" },
  { value: "superadmin", desc: "Vê tudo de todos" },
];
export function RoleSelect({
  value,
  onChange,
  disabled,
  busy,
}: {
  value: string;
  onChange: (role: "admin" | "superadmin") => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div className="flt-dd" ref={ref}>
      <button
        type="button"
        className="role-trigger"
        disabled={disabled || busy}
        title={disabled ? "Você não pode alterar o próprio papel" : "Alterar papel"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {busy ? <span className="button-spinner" /> : <RoleBadge role={value} />}
        {!disabled && <IconChevronDown className="flt-caret" />}
      </button>
      {open && !disabled && (
        <div className="flt-pop">
          {ROLE_OPTS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`flt-option ${value === o.value ? "active" : ""}`}
              onClick={() => {
                if (o.value !== value) onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="flt-option-main">
                {o.value === "superadmin" ? "Superadmin" : "Admin"}
                <span className="flt-option-sub">{o.desc}</span>
              </span>
              {value === o.value && <IconCheck />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Seletor genérico (substitui o <select> nativo) ----
// A convenção do projeto está declarada no topo deste arquivo: "seletor via
// popover próprio (sem <select> nativo)". Dois lugares ainda usavam o nativo —
// TokenPicker e NewUserModal — e destoavam do resto da interface.
// Ver AUDITORIA.md#UX-11.
export interface PickerOption {
  value: string;
  label: string;
  /** Segunda linha, para explicar a opção sem inflar o rótulo. */
  sub?: string;
  /** Cabeçalho de grupo exibido acima desta opção. */
  group?: string;
}

export function Picker({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  icon,
  placeholder,
  disabled,
}: {
  value: string;
  options: PickerOption[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  id?: string;
  icon?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { open, setOpen, ref } = useDropdown();
  const selected = options.find((o) => o.value === value);

  // Grupos só ganham cabeçalho quando MUDAM — assim a lista plana não vira uma
  // sequência de títulos repetidos. Calculado antes do JSX: acumular numa
  // variável durante o render é reatribuição pós-render (o ESLint reclama, com
  // razão — o Strict Mode do React renderiza duas vezes).
  const rows = options.map((o, i) => ({
    ...o,
    head: o.group && o.group !== options[i - 1]?.group ? o.group : null,
  }));

  return (
    <div className="flt-dd block" ref={ref}>
      <button
        id={id}
        type="button"
        className={`flt-trigger wide ${value ? "has-value" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {icon}
        <span className="flt-trigger-label">
          {selected ? selected.label : placeholder || ""}
        </span>
        <IconChevronDown className="flt-caret" />
      </button>
      {open && (
        <div className="flt-pop flt-pop-wide" role="listbox" aria-label={ariaLabel}>
          <div className="flt-options">
            {rows.map((o) => (
              <div key={o.value}>
                {o.head && <div className="flt-group">{o.head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={value === o.value}
                  className={`flt-option ${value === o.value ? "active" : ""}`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span className="flt-option-main">
                    {o.label}
                    {o.sub && <span className="flt-option-sub">{o.sub}</span>}
                  </span>
                  {value === o.value && <IconCheck />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
