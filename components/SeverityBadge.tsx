"use client";

import type { Severity } from "@/types";
import { useT, type MessageKey } from "@/lib/i18n";

// O rótulo de severidade era uma constante em português dentro de types/.
// Agora é chave de tradução — enums de domínio também precisam falar o idioma
// do usuário. Ver AUDITORIA.md#FEAT-04.
const KEY: Record<Severity, MessageKey> = {
  critical: "severity.critical",
  high: "severity.high",
  medium: "severity.medium",
  low: "severity.low",
  info: "severity.info",
};

export default function SeverityBadge({ severity }: { severity: Severity }) {
  const t = useT();
  return (
    <span className={`sev sev-${severity}`}>
      <span className="dot" />
      {t(KEY[severity])}
    </span>
  );
}

/** Chave de tradução de uma severidade — para quem precisa do texto solto. */
export function severityKey(s: Severity): MessageKey {
  return KEY[s];
}
