"use client";

// ============================================================
// Modal acessível compartilhado.
//
// Os modais anteriores eram uma <div> com onClick no overlay: sem role,
// sem foco, sem ESC, sem trava de rolagem — e um clique fora descartava uma
// correção que custou minutos e dinheiro. Ver AUDITORIA.md#UX-03 e #UX-04.
// ============================================================
import { useCallback, useEffect, useId, useRef } from "react";
import { useT } from "@/lib/i18n";
import { IconX } from "@/lib/icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  title,
  titleExtra,
  onClose,
  children,
  footer,
  /** Pergunta antes de fechar (usado quando há conteúdo a perder). */
  confirmClose,
  /** Bloqueia o fechamento — durante uma geração em andamento, por exemplo. */
  locked = false,
}: {
  title: React.ReactNode;
  titleExtra?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  confirmClose?: () => string | null;
  locked?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const requestClose = useCallback(() => {
    if (locked) return;
    const question = confirmClose?.();
    if (question && !window.confirm(question)) return;
    onClose();
  }, [confirmClose, locked, onClose]);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;

    // Trava a rolagem do fundo — sem isso, rolar dentro do modal arrasta a
    // página inteira atrás dele.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Foco inicial no primeiro elemento interativo (ou no próprio diálogo).
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;

      // Armadilha de foco: o Tab circula DENTRO do diálogo.
      const items = Array.from(
        ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [requestClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        // mouseDown (não click): arrastar uma seleção de dentro para fora não
        // deve fechar o modal.
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId} className="panel-title-row">
              {title}
              {titleExtra}
            </h2>
          </div>
          <button
            className="modal-close"
            onClick={requestClose}
            aria-label={t("common.close")}
            disabled={locked}
          >
            <IconX />
          </button>
        </div>

        {children}

        {footer}
      </div>
    </div>
  );
}
