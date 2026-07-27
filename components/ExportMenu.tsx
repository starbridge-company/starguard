"use client";

// Exportação dos achados (SARIF / CSV / JSON). Ver AUDITORIA.md#UX-10.
//
// Links diretos, não fetch: a rota devolve `Content-Disposition: attachment`,
// então o próprio navegador cuida do download — com o nome de arquivo que o
// servidor escolheu, e sem precisar montar um Blob em memória.
import Link from "next/link";
import { useDropdown } from "@/components/filters";
import { useT } from "@/lib/i18n";
import { IconDownload, IconChevronDown } from "@/lib/icons";

const FORMATS = [
  { format: "sarif", labelKey: "export.sarif", subKey: "export.sarifSub" },
  { format: "csv", labelKey: "export.csv", subKey: "export.csvSub" },
  { format: "json", labelKey: "export.json", subKey: "export.jsonSub" },
] as const;

export default function ExportMenu({
  analysisId,
  disabled,
}: {
  analysisId: string;
  disabled?: boolean;
}) {
  const t = useT();
  const { open, setOpen, ref } = useDropdown();

  return (
    <div className="flt-dd align-right" ref={ref}>
      <button
        type="button"
        className="button ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        title={disabled ? t("export.needScan") : undefined}
      >
        <IconDownload /> {t("export.label")}
        <IconChevronDown className="flt-caret" />
      </button>
      {open && (
        <div className="flt-pop flt-pop-wide" role="menu">
          <div className="flt-options">
            {FORMATS.map((f) => (
              <Link
                key={f.format}
                role="menuitem"
                className="flt-option"
                href={`/api/analyses/${analysisId}/export?format=${f.format}`}
                // Download é navegação para fora do app: o roteador do Next não
                // deve interceptar, senão nada baixa.
                prefetch={false}
                download
                onClick={() => setOpen(false)}
              >
                <span className="flt-option-main">
                  {t(f.labelKey)}
                  <span className="flt-option-sub">{t(f.subKey)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
