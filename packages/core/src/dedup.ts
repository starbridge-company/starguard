// ============================================================
// Deduplicação de achados: uma única regra, usada pelo servidor e pela tela.
//
// Antes existiam DUAS implementações com critérios diferentes filtrando o
// mesmo conjunto — o servidor descartava por proximidade OU CWE, o cliente
// exigia proximidade E (CWE ou regra). Ver AUDITORIA.md#ARQ-10.
//
// A regra descartava achado legítimo: no mesmo arquivo, `|linha_sast −
// linha_ia| ≤ 3` bastava, INDEPENDENTEMENTE do tipo de problema. Um IDOR na
// linha 40 sumia porque o SAST encontrou um `console.log` na 42. Agora a
// proximidade é necessária mas não suficiente: quando os dois lados declaram
// CWE, ele precisa bater. Ver AUDITORIA.md#BUG-15.
//
// Isomórfico de propósito (sem `server-only`): a tela de resultados importa
// daqui para não reescrever a regra.
// ============================================================
import type { DependencyVuln, Vulnerability } from "./types";

/** Janela de linhas dentro da qual dois achados podem ser o mesmo. */
export const LINE_WINDOW = 3;

export function normPath(p: string): string {
  return (p || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function cweOf(v: { cwe?: string }): string {
  return (v.cwe || "").toUpperCase().trim();
}

/**
 * O achado da IA já foi reportado pelo SAST?
 *
 * Rede de segurança determinística sobre a instrução do prompt: o mesmo
 * problema, encontrado pelas duas vias, aparece uma vez só.
 */
export function collidesWithSast(
  f: Vulnerability,
  sast: readonly Vulnerability[]
): boolean {
  const fp = normPath(f.file);
  const fcwe = cweOf(f);
  return sast.some((s) => {
    if (normPath(s.file) !== fp) return false;

    // Linha 0/ausente = a IA não soube localizar. Sem esse sinal não dá para
    // usar distância; sobra o CWE, se ambos os lados o declararem.
    const located = (s.line || 0) > 0 && (f.line || 0) > 0;
    if (located && Math.abs((s.line || 0) - (f.line || 0)) > LINE_WINDOW) {
      return false;
    }

    const scwe = cweOf(s);
    // Os dois classificaram o problema: se classificaram DIFERENTE, são
    // problemas diferentes — por mais perto que estejam.
    if (scwe && fcwe) return scwe === fcwe;

    // Sem classificação dos dois lados, a proximidade é tudo o que temos.
    return located;
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * O achado da IA já foi reportado pelo SCA?
 *
 * SCA não tem arquivo/linha — a colisão é por CVE (sinal forte) ou por nome de
 * pacote citado num contexto de dependência vulnerável. Achado de código que
 * só MENCIONA um pacote (ex.: "SSRF em fetch com axios") não colide, pois
 * falta o sinal de "dependência/versão/CVE".
 */
export function collidesWithSca(
  f: Vulnerability,
  sca: readonly DependencyVuln[]
): boolean {
  if (!sca.length) return false;
  const text = `${f.ruleId} ${f.title} ${f.description} ${f.cwe ?? ""} ${f.file}`;

  // 1) Mesmo CVE que o SCA já reportou.
  const cveSet = new Set(sca.map((d) => d.cve.toUpperCase()));
  const cited = text.toUpperCase().match(/CVE-\d{4}-\d{3,7}/g) || [];
  if (cited.some((c) => cveSet.has(c))) return true;

  // 2) Pacote do SCA citado em contexto de dependência.
  const lower = text.toLowerCase();
  const depSignal =
    /(vulner|desatualiz|outdated|vers[aã]o|version|depend[êe]nc|pacote|package|upgrade|atualiz|bump|cve)/i.test(
      lower
    );
  if (!depSignal) return false;
  return sca.some((d) => {
    const pkg = d.package.toLowerCase();
    // Limita o tamanho do nome do pacote antes de usá-lo na regex dinâmica:
    // além de já ser escapado (escapeRe), isso evita que uma entrada
    // anormalmente longa gere um padrão custoso de avaliar (CWE-1333).
    if (pkg.length < 3 || pkg.length > 100) return false;
    const re = new RegExp(`(^|[^a-z0-9_.@/-])${escapeRe(pkg)}([^a-z0-9_.@/-]|$)`, "i");
    return re.test(lower);
  });
}
