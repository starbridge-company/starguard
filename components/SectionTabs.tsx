"use client";

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
  return (
    <div className="section-tabs" role="tablist" aria-label="Seções da análise">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={`section-tab ${t.id === active ? "is-active" : ""}`}
          onClick={() => onChange(t.id)}
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
