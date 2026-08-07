"use client";

import { useRef } from "react";
import { useT } from "@/lib/i18n";

export type TabTone = "default" | "danger" | "warning" | "accent";

export interface SectionTab {
  id: string;
  label: string;
  count?: number;
  tone?: TabTone;
}

/**
 * Navegação por seções (segmented control). Cada aba é bem delimitada e pode
 * exibir um contador. Rola horizontalmente no mobile.
 */
export default function SectionTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: SectionTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const move = (index: number, direction: number) => {
    const next = (index + direction + tabs.length) % tabs.length;
    onChange(tabs[next]!.id);
    requestAnimationFrame(() => {
      const buttons = ref.current?.querySelectorAll<HTMLButtonElement>("[role=tab]");
      buttons?.[next]?.focus();
    });
  };
  return (
    <div ref={ref} className="section-tabs" role="tablist" aria-label={t("tab.ariaLabel")}>
      {tabs.map((t, index) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          tabIndex={t.id === active ? 0 : -1}
          className={`section-tab ${t.id === active ? "is-active" : ""}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); move(index, 1); }
            if (e.key === "ArrowLeft") { e.preventDefault(); move(index, -1); }
            if (e.key === "Home") { e.preventDefault(); move(index, -index); }
            if (e.key === "End") { e.preventDefault(); move(index, tabs.length - 1 - index); }
          }}
        >
          <span className="section-tab-label">{t.label}</span>
          {typeof t.count === "number" && (
            <span className={`section-tab-count tone-${t.tone || "default"}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
