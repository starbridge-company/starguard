// ============================================================
// Identidade estável de um achado, entre análises diferentes.
//
// Os ids que os parsers geram são POSICIONAIS ("V-1", "V-2", "D-3"): num novo
// scan do mesmo repositório, "V-3" pode ser uma vulnerabilidade completamente
// diferente. Marcar "já corrigi" por id corromperia o histórico em silêncio.
//
// A impressão digital é deliberadamente construída SEM o número da linha:
// editar código acima do achado desloca a linha sem mudar o problema, e isso
// faria um achado já resolvido ressuscitar como novo.
// Ver AUDITORIA.md#FEAT-01.
// ============================================================
import { createHash } from "node:crypto";
import type { Vulnerability, DependencyVuln } from "./types";

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/**
 * Normaliza o trecho de código: sem indentação, sem espaços repetidos e sem
 * caixa. Reindentar um arquivo não pode mudar a identidade do achado.
 */
function normSnippet(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 2000);
}

function hash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/** SAST e revisão por IA: regra + arquivo + trecho normalizado. */
export function vulnerabilityFingerprint(v: Vulnerability): string {
  const snippet = normSnippet(v.codeSnippet);
  return hash([
    v.source,
    v.ruleId || "",
    normPath(v.file || ""),
    // Sem trecho (comum em achados da IA), o título entra como desempate —
    // é o sinal mais estável que sobra.
    snippet || normSnippet(v.title),
  ]);
}

/** SCA: o par pacote+CVE já é a identidade natural; arquivo/linha não existem. */
export function dependencyFingerprint(d: DependencyVuln): string {
  return hash(["sca", (d.package || "").toLowerCase(), (d.cve || "").toUpperCase()]);
}
