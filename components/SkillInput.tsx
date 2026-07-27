"use client";

import { useRef } from "react";
import InfoTip from "@/components/InfoTip";
import { useT } from "@/lib/i18n";
import { IconSkills, IconX } from "@/lib/icons";

export interface SkillEntry {
  name: string;
  content: string;
}

export default function SkillInput({
  skills,
  onChange,
}: {
  skills: SkillEntry[];
  onChange: (s: SkillEntry[]) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const addEmpty = () =>
    onChange([...skills, { name: `skill-${skills.length + 1}.md`, content: "" }]);

  const update = (i: number, patch: Partial<SkillEntry>) =>
    onChange(skills.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const remove = (i: number) => onChange(skills.filter((_, idx) => idx !== i));

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const read = await Promise.all(
      Array.from(files)
        .slice(0, 20)
        .map(
          (f) =>
            new Promise<SkillEntry>((resolve) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({ name: f.name, content: String(reader.result || "") });
              reader.readAsText(f);
            })
        )
    );
    onChange([...skills, ...read]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="field">
      <label className="field-label-row">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <IconSkills /> {t("skillInput.label")}
        </span>
        <InfoTip
          title={t("skillInput.help")}
          content={t("skillInput.helpText")}
        />
      </label>

      {skills.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {skills.map((s, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-md)",
                padding: 12,
                display: "grid",
                gap: 8,
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={s.name}
                  placeholder={t("skillInput.namePlaceholder")}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="button danger"
                  onClick={() => remove(i)}
                  aria-label={t("skillInput.remove")}
                >
                  <IconX />
                </button>
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 90 }}
                value={s.content}
                placeholder={t("skillInput.contentPlaceholder")}
                onChange={(e) => update(i, { content: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="button ghost" onClick={addEmpty}>
          {t("skillInput.add")}
        </button>
        <button
          type="button"
          className="button ghost"
          onClick={() => fileRef.current?.click()}
        >
          {t("skillInput.upload")}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.txt,.mdx,.json,.yaml,.yml"
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
