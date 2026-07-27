// ============================================================
// Dicionários. Chaves planas com pontos; `{x}` marca interpolação.
//
// O português é a referência: toda chave existe aqui. O inglês pode estar
// incompleto — `t()` cai no português e, em último caso, devolve a própria
// chave (que aparece na tela e denuncia o que falta traduzir).
// ============================================================
import type { Locale } from "./config";

export const PT_BR = {
  // ---- Navegação e chrome ----
  "nav.newAnalysis": "Nova análise",
  "nav.analyses": "Análises",
  "nav.pullRequests": "Pull Requests",
  "nav.account": "Conta",
  "nav.governance": "Governança",
  "nav.dashboard": "Painel",
  "nav.users": "Usuários",
  "nav.globalAnalyses": "Análises globais",
  "nav.monitoring": "Monitoramento",
  "nav.lightMode": "Modo claro",
  "nav.darkMode": "Modo escuro",
  "nav.logout": "Sair",
  "nav.menu": "Menu",
  "nav.close": "Fechar",
  "nav.activeAccount": "conta ativa",
  "role.superadmin": "Superadmin",
  "role.admin": "Admin",

  // ---- Comuns ----
  "common.retry": "Tentar novamente",
  "common.refresh": "Atualizar",
  "common.cancel": "Cancelar",
  "common.close": "Fechar",
  "common.open": "Abrir",
  "common.report": "Relatório",
  "common.new": "Nova",
  "common.loading": "Carregando…",
  "common.language": "Idioma",

  // ---- Login ----
  "login.subtitle": "Copilot de Segurança · DevSecOps assistido por IA",
  "login.email": "E-mail",
  "login.password": "Senha",
  "login.submit": "Entrar",
  "login.hint": "Acesso restrito. Use as credenciais fornecidas pelo administrador.",
  "login.failed": "Não foi possível entrar.",

  // ---- Severidade ----
  "severity.critical": "Crítica",
  "severity.high": "Alta",
  "severity.medium": "Média",
  "severity.low": "Baixa",
  "severity.info": "Info",

  // ---- Estado do achado ----
  "status.open": "Aberto",
  "status.fixed": "Corrigido",
  "status.pr_open": "PR aberto",
  "status.pr_merged": "PR mergeado",
  "status.false_positive": "Falso positivo",
  "status.accepted_risk": "Risco aceito",
  "status.inherited": "herdado",

  // ---- Fases ----
  "phase.running": "rodando…",
  "phase.pending": "aguardando",
  "phase.error": "erro",
  "phase.done": "concluído",

  // ---- Tela de resultados ----
  "results.kicker": "Análise",
  "results.doneSubtitle": "Análise concluída. Comece pelas correções de código.",
  "results.runningSubtitle": "Rodando as 4 fases em tempo real…",
  "results.degraded":
    "Conexão instável — o acompanhamento continua tentando sozinho.",
  "results.refreshNow": "Atualizar agora",
  "results.loadFailed": "Falha ao carregar a análise.",
  "tab.overview": "Visão geral",
  "tab.fixes": "Correções",
  "tab.deps": "Dependências",
  "tab.threats": "Ameaças",
  "tab.skills": "Skills",

  "fixes.searchPlaceholder": "Buscar por arquivo, regra ou CWE…",
  "fixes.allSeverities": "Toda severidade",
  "fixes.allSources": "Toda origem",
  "fixes.sourceSast": "SAST",
  "fixes.sourceAi": "Revisão IA",
  "fixes.filterOpen": "Abertos ({n})",
  "fixes.filterResolved": "Resolvidos ({n})",
  "fixes.filterAll": "Todos",
  "fixes.selectAll": "Selecionar todas",
  "fixes.selectedCount": "{n} de {total} selecionadas",
  "fixes.fixWithAi": "Corrigir {n} com IA",
  "fixes.showMore": "Mostrar mais {n} de {total} restantes",
  "fixes.emptyFilters": "Nenhum achado para os filtros atuais.",
  "fixes.emptyResolved": "Todos os achados desta análise já foram resolvidos. 🎉",
  "fixes.emptyNoResolved": "Nenhum achado resolvido ainda.",
  "fixes.analyzing": "Analisando o código-fonte…",
  "fixes.noScanner":
    "Nenhum analisador de código rodou. {reasons} Isto não significa que o repositório esteja limpo — significa que ele não foi analisado.",
  "fixes.coverage":
    "A revisão por IA leu {reviewed} de {eligible} arquivos elegíveis (priorizando autenticação, rotas, banco e os arquivos que o SAST apontou). O SAST e o SCA analisaram o repositório inteiro.",

  // ---- Card de achado ----
  "card.line": "linha {n}",
  "card.technicalDetails": "Detalhes técnicos",
  "card.technicalHint": "Trecho do código e texto original da ferramenta",
  "card.technicalHintWithAttack":
    "Caminho de ataque, trecho do código e texto original da ferramenta",
  "card.attackScenario": "Como seria explorado",
  "card.originalText": "Texto original da ferramenta",
  "card.howToFix": "Como corrigir",
  "card.suggestion": "Sugestão de correção",
  "card.fixWithAi": "Corrigir com IA",
  "card.viewFix": "Ver correção",
  "card.markFixed": "Já corrigi",
  "card.markFalsePositive": "Falso positivo",
  "card.reopen": "Reabrir",
  "card.selectToFix": 'Selecionar "{title}" para corrigir',

  // ---- Modal de correção ----
  "fix.title": "Corrigir com IA",
  "fix.problem": "O problema",
  "fix.instructions": "Instruções para a IA (opcional)",
  "fix.generate": "Gerar correção",
  "fix.regenerate": "Refazer com estas instruções",
  "fix.regenerateHint":
    "Refazer consome uma nova chamada de IA — a correção atual já está guardada.",
  "fix.generating": "Gerando correção com IA…",
  "fix.whatChanged": "O que mudou e por quê",
  "fix.changesIn": "Alterações em {file}",
  "fix.noChange":
    "A IA não propôs nenhuma alteração no código. Ajuste as instruções e refaça, ou trate este achado manualmente. Não é possível abrir PR sem alteração.",
  "fix.openPr": "Abrir PR no GitHub",
  "fix.needRepo": "Informe a URL do repositório na Tela 1 para abrir PR.",
  "fix.prOpened": "PR #{number} aberto ({branch}).",
  "fix.viewOnGithub": "Ver no GitHub",
  "fix.multiFile":
    "O agente alterou {n} arquivos — todos entram no mesmo PR: {files}",
  "fix.wholeFile": "A IA recebeu o arquivo inteiro; o PR grava o conteúdo completo.",
  "fix.snippetOnly":
    "A IA recebeu apenas o trecho — não foi possível buscar o arquivo inteiro.",
  "fix.failed": "Falha ao gerar correção.",

  // ---- Diff ----
  "diff.showAll": "Mostrar tudo",
  "diff.onlyChanges": "Só o que mudou",
  "diff.fullFile": "Arquivo completo",
  "diff.viewDiff": "Ver diff",
  "diff.noChange": "nenhuma alteração",
  "diff.unchangedLines": "{n} linhas inalteradas",

  // ---- Conta ----
  "account.language": "Idioma da interface",
  "account.languageHint":
    "Vale para a interface e para os textos gerados por IA nas próximas análises.",
} as const;

export type MessageKey = keyof typeof PT_BR;

const EN: Partial<Record<MessageKey, string>> = {
  "nav.newAnalysis": "New analysis",
  "nav.analyses": "Analyses",
  "nav.pullRequests": "Pull Requests",
  "nav.account": "Account",
  "nav.governance": "Governance",
  "nav.dashboard": "Dashboard",
  "nav.users": "Users",
  "nav.globalAnalyses": "All analyses",
  "nav.monitoring": "Monitoring",
  "nav.lightMode": "Light mode",
  "nav.darkMode": "Dark mode",
  "nav.logout": "Sign out",
  "nav.menu": "Menu",
  "nav.close": "Close",
  "nav.activeAccount": "active account",
  "role.superadmin": "Superadmin",
  "role.admin": "Admin",

  "common.retry": "Try again",
  "common.refresh": "Refresh",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.open": "Open",
  "common.report": "Report",
  "common.new": "New",
  "common.loading": "Loading…",
  "common.language": "Language",

  "login.subtitle": "Security Copilot · AI-assisted DevSecOps",
  "login.email": "Email",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.hint": "Restricted access. Use the credentials provided by your administrator.",
  "login.failed": "Could not sign in.",

  "severity.critical": "Critical",
  "severity.high": "High",
  "severity.medium": "Medium",
  "severity.low": "Low",
  "severity.info": "Info",

  "status.open": "Open",
  "status.fixed": "Fixed",
  "status.pr_open": "PR open",
  "status.pr_merged": "PR merged",
  "status.false_positive": "False positive",
  "status.accepted_risk": "Accepted risk",
  "status.inherited": "inherited",

  "phase.running": "running…",
  "phase.pending": "waiting",
  "phase.error": "error",
  "phase.done": "done",

  "results.kicker": "Analysis",
  "results.doneSubtitle": "Analysis complete. Start with the code fixes.",
  "results.runningSubtitle": "Running the 4 phases in real time…",
  "results.degraded": "Unstable connection — still retrying in the background.",
  "results.refreshNow": "Refresh now",
  "results.loadFailed": "Failed to load the analysis.",
  "tab.overview": "Overview",
  "tab.fixes": "Fixes",
  "tab.deps": "Dependencies",
  "tab.threats": "Threats",
  "tab.skills": "Skills",

  "fixes.searchPlaceholder": "Search by file, rule or CWE…",
  "fixes.allSeverities": "Any severity",
  "fixes.allSources": "Any source",
  "fixes.sourceSast": "SAST",
  "fixes.sourceAi": "AI review",
  "fixes.filterOpen": "Open ({n})",
  "fixes.filterResolved": "Resolved ({n})",
  "fixes.filterAll": "All",
  "fixes.selectAll": "Select all",
  "fixes.selectedCount": "{n} of {total} selected",
  "fixes.fixWithAi": "Fix {n} with AI",
  "fixes.showMore": "Show {n} more of {total} remaining",
  "fixes.emptyFilters": "No findings match the current filters.",
  "fixes.emptyResolved": "Every finding in this analysis has been resolved. 🎉",
  "fixes.emptyNoResolved": "No resolved findings yet.",
  "fixes.analyzing": "Analyzing the source code…",
  "fixes.noScanner":
    "No code analyzer ran. {reasons} This does not mean the repository is clean — it means it was not analyzed.",
  "fixes.coverage":
    "The AI review read {reviewed} of {eligible} eligible files (prioritizing auth, routes, database and the files SAST flagged). SAST and SCA analyzed the whole repository.",

  "card.line": "line {n}",
  "card.technicalDetails": "Technical details",
  "card.technicalHint": "Code snippet and the tool's original text",
  "card.technicalHintWithAttack":
    "Attack path, code snippet and the tool's original text",
  "card.attackScenario": "How it would be exploited",
  "card.originalText": "Tool's original text",
  "card.howToFix": "How to fix",
  "card.suggestion": "Suggested fix",
  "card.fixWithAi": "Fix with AI",
  "card.viewFix": "View fix",
  "card.markFixed": "Already fixed",
  "card.markFalsePositive": "False positive",
  "card.reopen": "Reopen",
  "card.selectToFix": 'Select "{title}" to fix',

  "fix.title": "Fix with AI",
  "fix.problem": "The problem",
  "fix.instructions": "Instructions for the AI (optional)",
  "fix.generate": "Generate fix",
  "fix.regenerate": "Regenerate with these instructions",
  "fix.regenerateHint":
    "Regenerating costs another AI call — the current fix is already saved.",
  "fix.generating": "Generating fix with AI…",
  "fix.whatChanged": "What changed and why",
  "fix.changesIn": "Changes in {file}",
  "fix.noChange":
    "The AI proposed no change to the code. Adjust the instructions and regenerate, or handle this finding manually. A PR cannot be opened without a change.",
  "fix.openPr": "Open PR on GitHub",
  "fix.needRepo": "Provide the repository URL on Screen 1 to open a PR.",
  "fix.prOpened": "PR #{number} opened ({branch}).",
  "fix.viewOnGithub": "View on GitHub",
  "fix.multiFile": "The agent changed {n} files — all go into the same PR: {files}",
  "fix.wholeFile": "The AI received the whole file; the PR writes the full content.",
  "fix.snippetOnly":
    "The AI only received the snippet — the whole file could not be fetched.",
  "fix.failed": "Failed to generate the fix.",

  "diff.showAll": "Show everything",
  "diff.onlyChanges": "Only what changed",
  "diff.fullFile": "Full file",
  "diff.viewDiff": "View diff",
  "diff.noChange": "no changes",
  "diff.unchangedLines": "{n} unchanged lines",

  "account.language": "Interface language",
  "account.languageHint":
    "Applies to the interface and to AI-generated text in future analyses.",
};

export const MESSAGES: Record<Locale, Partial<Record<MessageKey, string>>> = {
  "pt-BR": PT_BR,
  en: EN,
};
