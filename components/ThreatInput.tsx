"use client";

import InfoTip from "@/components/InfoTip";
import { useT } from "@/lib/i18n";

export default function ThreatInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  return (
    <div className="field">
      <label htmlFor="sys-desc" className="field-label-row">
        {t("threatInput.label")}
        <InfoTip
          title={t("threatInput.help")}
          content={t("threatInput.helpText")}
        />
      </label>
      <textarea
        id="sys-desc"
        className="textarea"
        style={{ minHeight: 150 }}
        placeholder={t("threatInput.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
