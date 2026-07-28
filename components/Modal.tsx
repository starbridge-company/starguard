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

// Alvo preferido do foco inicial. O primeiro focável em ordem de documento é o
// InfoTip do cabeçalho — um <span tabIndex={0}> que abre o balão no `onFocus`.
// Focá-lo ao abrir jogava um pop-up de ajuda por cima do formulário antes de a
// pessoa digitar qualquer coisa. Ver AUDITORIA.md#BUG-23.
const FIELD =
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea:not([disabled]), select:not([disabled])';

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

  // ATENÇÃO: montagem e desmontagem, e só isso — a lista de dependências é
  // vazia de propósito. Os três modais consumidores passam `confirmClose` como
  // arrow inline, então a identidade de `requestClose` muda a CADA render. Com
  // `[requestClose]` aqui, cada tecla digitada num campo remontava o efeito:
  // a limpeza devolvia o foco a quem abriu o modal e o corpo o trazia de volta
  // para o primeiro focável do diálogo — o InfoTip do cabeçalho, que abre o
  // balão no `onFocus`. Dava para digitar UM caractere no "Novo usuário", e o
  // pop-up de ajuda roubava o cursor. Medido em Chromium: com `[requestClose]`,
  // `#nu-name` fica com "M" de "Maria Silva" e o foco vai parar no `infotip`.
  // Ver AUDITORIA.md#BUG-23.
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;

    // Trava a rolagem do fundo — sem isso, rolar dentro do modal arrasta a
    // página inteira atrás dele.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Foco inicial no primeiro CAMPO; sem campo, no primeiro focável que não
    // seja um InfoTip; sem nada disso, no próprio diálogo.
    const field = ref.current?.querySelector<HTMLElement>(FIELD);
    const fallback = Array.from(
      ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
    ).find((el) => !el.classList.contains("infotip"));
    (field ?? fallback ?? ref.current)?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, []);

  // O ouvinte de teclado, sim, reassina quando `requestClose` muda: trocar
  // ouvinte não mexe em foco nem em rolagem, então é inofensivo.
  useEffect(() => {
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
    return () => document.removeEventListener("keydown", onKeyDown, true);
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
