import type { Severity } from "@/types";
import { SEVERITY_LABEL_PT } from "@/types";

export default function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`sev sev-${severity}`}>
      <span className="dot" />
      {SEVERITY_LABEL_PT[severity]}
    </span>
  );
}
