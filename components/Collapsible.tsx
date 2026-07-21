"use client";

import { useId, useState, type ReactNode } from "react";
import { IconChevronDown } from "@/lib/icons";

/**
 * Seção recolhível para divulgação progressiva — mantém a tela inicial
 * calma e revela detalhes só quando o usuário pede.
 */
export default function Collapsible({
  title,
  hint,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className={`collapsible ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="collapsible-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="collapsible-head">
          {icon && <span className="collapsible-icon">{icon}</span>}
          <span className="collapsible-titles">
            <span className="collapsible-title">{title}</span>
            {hint && <span className="collapsible-hint">{hint}</span>}
          </span>
        </span>
        <IconChevronDown className="collapsible-chevron" aria-hidden />
      </button>
      {open && (
        <div id={id} className="collapsible-body">
          {children}
        </div>
      )}
    </div>
  );
}
