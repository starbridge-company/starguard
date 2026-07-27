"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { IconInfo } from "@/lib/icons";

type Side = "top" | "bottom";

interface Coords {
  top: number;
  left: number;
  side: Side;
}

/**
 * Pop-up de descrição reutilizável ("explique isto").
 * - Abre no hover, no foco (teclado) e no clique (toque).
 * - O balão é renderizado via PORTAL no <body> e posicionado com
 *   `position: fixed` a partir do retângulo do gatilho. Isso evita que
 *   ancestrais com `backdrop-filter`/`transform` (que criam um containing
 *   block para elementos fixed) joguem o balão para o lugar errado.
 */
export default function InfoTip({
  title,
  content,
  children,
  side = "top",
  label,
  className = "",
  size = "sm",
}: {
  title?: string;
  content: ReactNode;
  children?: ReactNode;
  side?: Side;
  /** Rótulo acessível. Sem ele, cai no genérico traduzido. */
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<Coords>({ top: 0, left: 0, side });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  const WIDTH = size === "md" ? 320 : 260;

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 10;
    const half = WIDTH / 2;
    const left = Math.min(
      Math.max(r.left + r.width / 2, half + margin),
      window.innerWidth - half - margin
    );
    // Prefere abrir para cima; se faltar espaço, cai para baixo.
    const chosen: Side = side === "top" && r.top < 170 ? "bottom" : side;
    const top = chosen === "top" ? r.top : r.bottom;
    setCoords({ top, left, side: chosen });
  }, [side, WIDTH]);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  const toggle = () =>
    setOpen((v) => {
      if (!v) place();
      return !v;
    });

  return (
    <span
      ref={triggerRef}
      className={`infotip ${children ? "has-trigger" : ""} ${className}`}
      tabIndex={0}
      role="button"
      aria-label={label ?? t("common.moreInfo")}
      aria-expanded={open}
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {children ?? <IconInfo className="infotip-icon" aria-hidden />}
      {open &&
        mounted &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className={`infotip-bubble side-${coords.side} size-${size}`}
            style={{ top: coords.top, left: coords.left }}
          >
            {title && <span className="infotip-title">{title}</span>}
            <span className="infotip-body">{content}</span>
          </span>,
          document.body
        )}
    </span>
  );
}
