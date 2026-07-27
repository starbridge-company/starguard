// ============================================================
// Correção de dependência vulnerável.
//
// Corrigir dependência é diferente de corrigir código: o QUE fazer já é
// conhecido — o Trivy diz o pacote e a versão que corrige. Não há dúvida a
// resolver com IA sobre o alvo. O que exige olhar o repositório é ONDE mexer:
// a declaração pode estar com faixa (`^`, `~`), num workspace de monorepo, ou
// nem existir no manifesto (dependência transitiva, que precisa de override).
//
// Daí o desenho: o alvo é determinístico e sai daqui de graça; a IA entra só
// para localizar e editar. Ver a regra do CLAUDE.md — "verifique se dá para
// resolver pelo catálogo antes de chamar".
//
// Isomórfico: a tela usa `canFixDependency` para decidir se mostra o botão.
// ============================================================
import type { DependencyVuln, FixTarget } from "@/types";
import type { MessageKey, Values } from "@/lib/i18n/translate";

/** Como regerar o lock depois que o manifesto muda, por ecossistema. */
const LOCK_COMMAND: Record<string, string> = {
  npm: "npm install",
  yarn: "yarn install",
  pnpm: "pnpm install",
  pip: "pip install -r requirements.txt",
  poetry: "poetry lock",
  pipenv: "pipenv lock",
  bundler: "bundle install",
  composer: "composer update <pacote>",
  cargo: "cargo update -p <pacote>",
  gomod: "go mod tidy",
};

export function lockCommandFor(dep: DependencyVuln): string | undefined {
  const eco = (dep.ecosystem || "").toLowerCase();
  return LOCK_COMMAND[eco];
}

/**
 * Dá para propor correção?
 *
 * Sem `fixedVersion` o upstream não publicou correção — gerar qualquer coisa
 * aqui seria inventar. Sem manifesto conhecido não sabemos onde editar.
 */
export function canFixDependency(dep: DependencyVuln): boolean {
  return !!dep.fixedVersion && !!dep.manifest;
}

/** Por que o botão está desabilitado — a tela precisa dizer, não só apagar. */
export function whyCannotFix(
  dep: DependencyVuln
): "no_fixed_version" | "no_manifest" | null {
  if (!dep.fixedVersion) return "no_fixed_version";
  if (!dep.manifest) return "no_manifest";
  return null;
}

/**
 * O agente da Fase 4 não executa comandos (`Bash` está em `disallowedTools`,
 * por desenho anti prompt-injection). Ele edita o manifesto, mas NÃO consegue
 * regerar o lockfile — e um PR com manifesto novo e lock velho quebra o
 * `npm ci` do CI de quem recebe.
 *
 * Não dá para esconder isso: o texto vai no corpo do PR e na tela.
 *
 * Devolve CHAVE + valores, não texto pronto: os dois destinos (tela e corpo do
 * PR) traduzem no idioma de quem está usando. Montar a frase aqui prenderia o
 * aviso ao português — e este é o aviso que evita um PR que quebra o CI de
 * quem recebe. Ver AUDITORIA.md#FEAT-04.
 */
export interface LockfileWarning {
  key: MessageKey;
  values: Values;
}

export function lockfileWarning(dep: DependencyVuln): LockfileWarning | null {
  if (!dep.lockfile) return null;
  const cmd = lockCommandFor(dep);
  const values: Values = {
    manifest: dep.manifest || "",
    lockfile: dep.lockfile,
  };
  return cmd
    ? { key: "deps.lockWarningWithCmd", values: { ...values, cmd } }
    : { key: "deps.lockWarning", values };
}

/** Instruções para o motor de correção. Determinísticas no alvo. */
export function buildDependencyFixPrompt(dep: DependencyVuln): string {
  const transitiva = `Se "${dep.package}" NÃO estiver declarado diretamente em ${dep.manifest}, trate-o como dependência transitiva: adicione a restrição no mecanismo do ecossistema (por exemplo "overrides" no npm, "resolutions" no yarn) em vez de inventar uma dependência direta.`;

  return [
    `Atualize a dependência "${dep.package}" da versão ${dep.installedVersion} para ${dep.fixedVersion} (ou a menor versão segura compatível acima dela).`,
    `Motivo: ${dep.cve} — ${dep.title}`,
    ``,
    `Regras:`,
    `- Edite APENAS ${dep.manifest}. Não toque no lockfile: ele é gerado por ferramenta, não editado à mão.`,
    `- Preserve o estilo da faixa de versão já usada no arquivo (se está "^1.2.3", mantenha o "^").`,
    `- Não atualize nenhuma outra dependência de carona.`,
    `- ${transitiva}`,
  ].join("\n");
}

/** Título do PR — curto e legível na lista do GitHub. */
export function dependencyFixTitle(dep: DependencyVuln): string {
  return `chore(deps): ${dep.package} ${dep.installedVersion} → ${dep.fixedVersion} (${dep.cve})`;
}

/**
 * Adapta a dependência para o formato que o modal de correção consome.
 *
 * O arquivo é o MANIFESTO (não o lockfile que o scanner leu): é ali que a
 * edição acontece. Linha 0 porque dependência não tem linha — quem lê o
 * manifesto encontra o pacote pelo nome.
 */
export function dependencyAsFixTarget(dep: DependencyVuln): FixTarget {
  return {
    id: dep.id,
    ruleId: dep.cve,
    title: dep.explain?.title || `${dep.package} ${dep.installedVersion}`,
    severity: dep.severity,
    file: dep.manifest || dep.lockfile || "package.json",
    line: 0,
    description:
      dep.explain?.whatItIs || dep.description || dep.title || dep.cve,
    // A "sugestão" aqui é o alvo determinístico — não precisou de IA para sair.
    suggestion: buildDependencyFixPrompt(dep),
    explain: dep.explain,
  };
}
