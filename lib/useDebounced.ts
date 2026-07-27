"use client";

// Atrasa a propagação de um valor que muda a cada tecla. Sem isto, a caixa de
// busca das listagens disparava UMA requisição por caractere digitado — com
// COUNT(*) + ILIKE no banco a cada uma — e ainda corria o risco de uma
// resposta antiga chegar depois e sobrescrever a nova.
// Ver AUDITORIA.md#BUG-05.
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
