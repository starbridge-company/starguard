// ============================================================
// Dicionários. Chaves planas com pontos; `{x}` marca interpolação.
//
// O português é a REFERÊNCIA: `PT_BR` define o conjunto de chaves e o tipo
// `MessageKey` sai dele. Inglês e espanhol são `Record<MessageKey, string>`
// COMPLETOS — não `Partial`. Isso é de propósito: uma chave nova em português
// vira erro de compilação nos outros dois idiomas, em vez de cair no fallback
// e produzir uma tela meio traduzida que ninguém percebe até trocar o idioma.
// Ver AUDITORIA.md#FEAT-04 e o teste tests/i18n.test.ts.
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
  "role.change": "Alterar papel",
  "role.cannotChangeSelf": "Você não pode alterar o próprio papel",

  // ---- Metadados do documento ----
  "meta.title": "StarGuard | Copilot de Segurança",
  "meta.description":
    "Plataforma de segurança assistida por IA para desenvolvimento seguro de software — DevSecOps ponta a ponta, headless e AI-native.",

  // ---- Comuns ----
  "common.retry": "Tentar novamente",
  "common.refresh": "Atualizar",
  "common.cancel": "Cancelar",
  "common.details": "Ver detalhes",
  "common.close": "Fechar",
  "common.open": "Abrir",
  "common.report": "Relatório",
  "common.new": "Nova",
  "common.loading": "Carregando…",
  "common.language": "Idioma",
  "common.moreInfo": "Mais informações",
  "common.total": "{n} no total",
  "common.previousPage": "Página anterior",
  "common.nextPage": "Próxima página",

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
  // "não pedi isto" não é nem "aguardando" nem "erro". Ver StepStatus.
  "phase.skipped": "não executado",

  // ---- Tela de resultados ----
  "results.kicker": "Análise",
  "results.doneSubtitle": "Análise concluída. Comece pelas correções de código.",
  "results.runningSubtitle": "Rodando as 4 fases em tempo real…",
  "results.degraded":
    "Conexão instável — o acompanhamento continua tentando sozinho.",
  "results.refreshNow": "Atualizar agora",
  "results.phasesFailed": "{n} fase(s) falharam:",
  "results.goToPhase": "Ver detalhes",
  "results.loadFailed": "Falha ao carregar a análise.",
  "results.progressLabel": "progresso",
  "tab.overview": "Visão geral",
  "tab.fixes": "Correções",
  "tab.deps": "Dependências",
  "tab.requirements": "Requisitos",
  "tab.skills": "Skills",
  "tab.ariaLabel": "Seções da análise",

  "fixes.searchPlaceholder": "Buscar por arquivo, regra ou CWE…",
  "fixes.allSeverities": "Toda severidade",
  "fixes.allSources": "Toda origem",
  "fixes.sourceSast": "SAST",
  "fixes.sourceAi": "Revisão IA",
  "fixes.filterOpen": "Abertos ({n})",
  "fixes.filterResolved": "Resolvidos ({n})",
  "fixes.filterAll": "Todos",
  "deps.installed": "instalada",
  "deps.fixedIn": "corrigida em",
  "deps.manifestHint": "Arquivo que a correção edita",
  "deps.fixWithAi": "Corrigir com IA",
  "deps.noFixedVersion":
    "Ainda não há versão corrigida publicada para este pacote — não há o que propor sem inventar.",
  "deps.noManifest":
    "Não foi possível identificar o arquivo onde a dependência é declarada.",
  "deps.selectPage": "Selecionar as {n} desta página",
  "deps.selectAllFiltered": "Selecionar todas as {n}",
  "deps.fixSelected": "Corrigir {n} com IA",
  "deps.lockWarningWithCmd":
    "A correção altera {manifest}; o arquivo de lock ({lockfile}) NÃO é regerado automaticamente — rode `{cmd}` e inclua o lock no commit antes de mergear.",
  "deps.lockWarning":
    "A correção altera {manifest}; o arquivo de lock ({lockfile}) NÃO é regerado automaticamente — regere o lock com o gerenciador do projeto antes de mergear.",
  "fixes.selectPage": "Selecionar as {n} desta página",
  "fixes.selectAllFiltered": "Selecionar todas as {n}",
  "fixes.clearAll": "Limpar seleção",
  "fixes.selectedCount": "{n} de {total} selecionadas",
  "fixes.fixWithAi": "Corrigir {n} com IA",
  "fixes.showMore": "Mostrar mais {n} de {total} restantes",
  "fixes.emptyFilters": "Nenhum achado para os filtros atuais.",
  "fixes.emptyResolved": "Todos os achados desta análise já foram resolvidos. 🎉",
  "fixes.emptyNoResolved": "Nenhum achado resolvido ainda.",
  "fixes.empty": "Nenhuma correção de segurança encontrada. 🎉",
  "fixes.analyzing": "Analisando o código-fonte…",
  "fixes.noScanner":
    "Nenhum analisador de código rodou. {reasons} Isto não significa que o repositório esteja limpo — significa que ele não foi analisado.",
  "fixes.coverage":
    "A revisão por IA leu {reviewed} de {eligible} arquivos elegíveis (priorizando autenticação, rotas, banco e os arquivos que o SAST apontou). O SAST e o SCA analisaram o repositório inteiro.",
  "fixes.coverageTruncated": "{n} arquivo(s) foram truncados por tamanho.",

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
  "card.recommendation": "Recomendação",
  "card.aiGenerated":
    "Texto gerado por IA a partir do repositório analisado — confira antes de tratar como veredito da ferramenta.",
  "card.confidenceMedium": "confiança média",
  "card.confidenceMediumHint":
    "A revisão por IA não teve certeza deste achado. Confira antes de agir.",
  "card.openOnGitHubHint":
    "Abrir no GitHub (código atual do repositório — pode ter mudado desde a análise)",
  "filter.confidence": "Confiança",
  "filter.confidenceAll": "Toda",
  "filter.confidenceHigh": "Só alta",
  "filter.severity": "Severidade",
  "filter.source": "Origem",
  "filter.byStatus": "Filtrar por estado",
  "card.fixWithAi": "Corrigir com IA",
  "card.viewFix": "Ver correção",
  "card.markFixed": "Já corrigi",
  "card.markFalsePositive": "Falso positivo",
  "card.reopen": "Reabrir",
  "card.selectToFix": 'Selecionar "{title}" para corrigir',

  // ---- Modal de correção ----
  "fix.title": "Corrigir com IA",
  // A extensão do VS Code mostra o diff ANTES de gravar; estes dois rótulos
  // são o botão de confirmação e a confirmação de que gravou.
  "fix.apply": "Aplicar a correção",
  "fix.applied": "Correção aplicada.",
  "fix.problem": "O problema",
  "fix.instructions": "Instruções para a IA (opcional)",
  "fix.generate": "Gerar correção",
  "fix.regenerate": "Refazer com estas instruções",
  "fix.regenerateHint":
    "Refazer consome uma nova chamada de IA — a correção atual já está guardada.",
  "fix.confirmDiscard":
    "Você escreveu instruções e ainda não gerou a correção. Fechar agora descarta o que digitou. Fechar mesmo assim?",
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
  // Frase-guia que já vem escrita na textarea do modal (lib/constants.ts).
  "fix.guide":
    "Corrija apenas este problema de segurança, sem alterar a lógica de negócio, mantendo o estilo e a indentação do arquivo.",
  // Exibida no lugar da sugestão genérica gravada pelo scanner.
  "fix.genericSuggestion": "Revise o trecho conforme a recomendação.",

  // ---- Diff ----
  "diff.showAll": "Mostrar tudo",
  "diff.onlyChanges": "Só o que mudou",
  "diff.fullFile": "Arquivo completo",
  "diff.viewDiff": "Ver diff",
  "diff.noChange": "nenhuma alteração",
  "diff.unchangedLines": "{n} linhas inalteradas",

  // ---- Onboarding (nova análise) ----
  "onb.kicker": "Nova análise",
  "onb.title": "Vamos analisar seu projeto",
  "onb.subtitle":
    "Descreva o sistema e clique em iniciar — o StarGuard cuida das 4 fases.",
  "onb.phases": "As 4 fases",
  "onb.projectName": "Nome do projeto",
  "onb.projectPlaceholder": "Ex.: Portal do Paciente",
  "onb.optional": "Repositório e skills",
  "onb.optionalHint": "Opcional — conecte o GitHub e envie skills para validar",
  "onb.submit": "Iniciar análise",
  "onb.failed": "Falha ao iniciar a análise.",
  "phase1.label": "Ameaças",
  "phase1.desc":
    "Fase 1 · Modela ameaças e requisitos de segurança a partir do seu contexto.",
  "phase2.label": "Skills",
  "phase2.desc": "Fase 2 · Valida skills/prompts contra injeção e exfiltração.",
  "phase3.label": "Software",
  "phase3.desc":
    "Fase 3 · SAST + SCA sobre o repositório, priorizados por severidade.",
  "phase4.label": "Correção",
  "phase4.desc": "Fase 4 · Gera a correção e abre o Pull Request no GitHub.",

  // ---- Contexto do sistema (Tela 1) ----
  "threatInput.label": "Contexto do sistema",
  "threatInput.help": "O que descrever aqui",
  "threatInput.helpText":
    "Cole a descrição do sistema, notas de reunião ou requisitos de compliance. Este texto vira contexto para as 4 fases: ameaças, validação de skills, scan e correção. Ex.: dados sensíveis, fluxos de login, integrações de pagamento e regras de negócio.",
  "threatInput.placeholder":
    "Ex.: API de telemedicina que armazena dados de saúde (LGPD). Login por e-mail/senha, prontuários por paciente, pagamento por cartão (PCI). Um médico só acessa pacientes da sua clínica…",

  // ---- Repositório (Tela 1) ----
  "repo.label": "Repositório GitHub",
  "repo.help": "URL do repositório",
  "repo.helpText":
    "Somente github.com é aceito (allowlist anti-SSRF). Sem repositório, a Fase 3 (scan de código) não roda — as demais fases seguem normalmente.",
  "repo.placeholder": "https://github.com/starbridge/meu-projeto",
  "repo.invalid":
    "URL inválida. Use o formato https://github.com/dono/repositorio — só github.com é aceito.",
  "repo.tokenLabel": "Token de acesso",
  "repo.tokenHelp": "Personal Access Token",
  "repo.tokenHelpText":
    "Necessário apenas para repositórios privados. O token vive só em memória durante o job e nunca é persistido nem devolvido ao cliente.",
  "repo.tokenPlaceholder": "ghp_… (opcional)",

  // ---- Seletor de token (Tela 1) ----
  "tokenPicker.help": "Token do GitHub",
  "tokenPicker.helpText":
    "Necessário só para repositórios privados / abrir PR. Escolha um token salvo (cifrado na sua conta) ou digite um novo. Um token novo pode ser salvo na conta para reutilizar — sempre cifrado, nunca em texto puro.",
  "tokenPicker.none": "Nenhum (repositório público)",
  "tokenPicker.new": "+ Novo token…",
  "tokenPicker.saveToAccount": "Salvar na conta (cifrado)",
  "tokenPicker.namePlaceholder": "Nome do token (ex.: PAT pessoal)",

  // ---- Skills enviadas (Tela 1) ----
  "skillInput.label": "Skills a validar",
  "skillInput.help": "Validação de skills",
  "skillInput.helpText":
    "Envie SKILL.md, prompts ou templates para a Fase 2 checar prompt-injection, exfiltração de dados e desvio de política. Opcional.",
  "skillInput.namePlaceholder": "nome-da-skill.md",
  "skillInput.contentPlaceholder":
    "Cole o conteúdo da skill/prompt (SKILL.md, template…)",
  "skillInput.remove": "Remover skill",
  "skillInput.add": "+ Adicionar skill",
  "skillInput.upload": "Enviar arquivos",

  // ---- Listagens e filtros ----
  "list.historyKicker": "Histórico",
  "list.analysesTitle": "Análises",
  "list.analysesSubtitle":
    "Suas análises de segurança, da mais recente à mais antiga.",
  "list.searchAnalyses": "Buscar por projeto ou repositório…",
  "list.colProject": "Projeto",
  "list.colSeverities": "Severidades",
  "list.colFindings": "Achados",
  "list.colStatus": "Status",
  "list.colCreated": "Criada",
  "list.empty": "Nenhuma análise ainda.",
  "list.startFirst": "Inicie a primeira",
  "list.loadFailed": "Falha ao carregar as análises.",
  "list.prs": "{n} PR(s)",
  "list.openRepo": "Abrir repositório",

  // ---- Novo usuário (governança) ----
  "newUser.title": "Novo usuário",
  "newUser.subtitle": "Defina o acesso e o papel da nova conta.",
  "newUser.help": "Criar usuário",
  "newUser.helpText":
    "O usuário entra com o e-mail e a senha definidos aqui. Superadmin enxerga tudo de todos; admin vê apenas o próprio histórico. A senha é guardada com hash Argon2id.",
  "newUser.name": "Nome",
  "newUser.namePlaceholder": "Ex.: Maria Silva",
  "newUser.email": "E-mail",
  "newUser.emailPlaceholder": "pessoa@empresa.com",
  "newUser.password": "Senha",
  "newUser.passwordPlaceholder": "mínimo 8 caracteres",
  "newUser.passwordTooShort": "A senha precisa de pelo menos 8 caracteres.",
  "newUser.role": "Papel",
  "newUser.roleAdminSub": "Vê apenas o próprio histórico",
  "newUser.roleSuperadminSub": "Vê tudo de todos",
  "newUser.submit": "Criar usuário",
  "newUser.failed": "Falha ao criar o usuário.",
  "newUser.confirmDiscard":
    "Você preencheu o formulário e ainda não criou o usuário. Fechar agora descarta o que digitou. Fechar mesmo assim?",

  // ---- Stepper das 4 fases ----
  "pipe.ariaLabel": "Progresso das 4 fases",
  "pipe.status.pending": "Aguardando",
  "pipe.status.running": "Rodando",
  "pipe.status.done": "Concluído",
  "pipe.status.error": "Erro",
  "pipe.status.skipped": "Não executado",
  "pipe.plan.short": "Ameaças",
  "pipe.plan.phase": "Fase 1 · Plan",
  "pipe.plan.desc":
    "Modela ameaças e deriva requisitos de segurança a partir do contexto do sistema.",
  "pipe.skills.short": "Skills",
  "pipe.skills.phase": "Fase 2 · Code",
  "pipe.skills.desc":
    "Valida skills/prompts contra prompt-injection, exfiltração e desvio de política.",
  "pipe.software.short": "Software",
  "pipe.software.phase": "Fase 3 · Code",
  "pipe.software.desc":
    "Roda SAST + SCA sobre o repositório e prioriza os achados por severidade.",
  "pipe.refactor.short": "Correção",
  "pipe.refactor.phase": "Fase 4 · Refactor",
  "pipe.refactor.desc":
    "Correção do código e abertura do Pull Request, sob demanda por achado.",

  // ---- Métricas do stepper ----
  "metric.threats": "ameaças",
  "metric.requirements": "requisitos",
  "metric.skills": "skills",
  "metric.rejected": "reprovadas",
  "metric.sast": "SAST",
  "metric.ai": "IA",
  "metric.sca": "SCA",
  "metric.fixes": "correções",
  "metric.prs": "PRs",

  // ---- Pull Requests ----
  "pr.tokenRequired": "Escolha o token do GitHub",
  "pr.tokenPrivateHint":
    "Este repositório é privado, então o PR precisa ser aberto com um token seu.",
  "pr.savedTokens": "Tokens salvos",
  "pr.newToken": "+ Usar um token novo…",
  "pr.retryWithToken": "Abrir PR com este token",
  "pr.tokenScopeHint":
    "Precisa de permissão de escrita. Repositório público usa o token do servidor automaticamente.",
  "pr.kicker": "Correções enviadas",
  "pr.subtitle": "PRs de correção que você abriu a partir das análises.",
  "pr.empty":
    "Você ainda não abriu nenhum Pull Request. Gere correções em uma análise e abra um PR — ele aparece aqui.",
  "pr.loadFailed": "Falha ao carregar os Pull Requests.",
  "pr.colRepo": "Repositório",
  "pr.colFiles": "Arquivos",
  "pr.colOpened": "Aberto",
  "pr.viewAnalysis": "Análise",
  "pr.openOnGithub": "Abrir no GitHub",
  // Texto que vai para dentro do PR — segue o idioma de quem abriu.
  "pr.fixTitle": "Correção de segurança: {title}",
  "pr.batchTitle": "Correções de segurança StarGuard ({n})",
  "pr.batchIntro":
    "Correções de segurança geradas pelo StarGuard ({findings} achado(s) em {files} arquivo(s)).",
  "pr.changedFiles": "Arquivos alterados: {files}",
  "pr.reviewBeforeMerge": "Revise cada alteração antes de mergear.",

  "export.label": "Exportar",
  "export.needScan": "A Fase 3 (scan) ainda não produziu achados para exportar.",
  "export.sarif": "SARIF 2.1.0",
  "export.sarifSub": "Sobe direto no GitHub Code Scanning",
  "export.csv": "CSV",
  "export.csvSub": "Planilha (Excel, Sheets)",
  "export.json": "JSON",
  "export.jsonSub": "Dado bruto para pipeline",
  // Cabeçalho da PLANILHA — quem abre no Excel lê estas colunas. O JSON, que é
  // contrato de máquina, mantém as chaves em inglês de propósito.
  "csv.id": "id",
  "csv.source": "origem",
  "csv.severity": "severidade",
  "csv.rule": "regra",
  "csv.cwe": "cwe",
  "csv.owasp": "owasp",
  "csv.file": "arquivo",
  "csv.line": "linha",
  "csv.title": "titulo",
  "csv.description": "descricao",
  "csv.howToFix": "como_corrigir",
  "export.depUpgradeTo": "Atualizar para {version}",
  "export.depNoFix": "Sem correção publicada",
  "export.depUpgradeHelp": "Atualize {pkg} para {version} ou superior.",
  "export.depNoFixHelp": "Não há versão corrigida publicada para {pkg}.",
  "list.delete": "Excluir",
  "list.deleteOf": "Excluir a análise {name}",
  "list.deleteConfirm":
    "Excluir a análise “{name}”? Ela sai da sua lista; os achados e a trilha de auditoria continuam guardados.",
  "list.deleteFailed": "Falha ao excluir a análise.",
  "filter.all": "Todas",
  "filter.done": "Concluídas",
  "filter.running": "Rodando",
  "filter.error": "Erro",
  "filter.queued": "Fila",
  "filter.anyDate": "Qualquer data",
  "filter.today": "Hoje",
  "filter.last7": "Últimos 7 dias",
  "filter.last30": "Últimos 30 dias",
  "filter.period": "Período",
  "filter.from": "De",
  "filter.to": "Até",
  "filter.since": "desde {date}",
  "filter.until": "até {date}",
  "filter.search": "Buscar…",
  "filter.clearSearch": "Limpar busca",
  "filter.allUsers": "Todos os usuários",
  "filter.filterUsers": "Filtrar usuários…",
  "filter.noUsers": "Nenhum usuário.",

  // ---- Correção em lote ----
  "batch.title": "Corrigir em lote",
  "batch.whatHappens": "O que vai acontecer",
  "batch.plan":
    "{findings} achado(s) em {files} arquivo(s) ⇒ {calls} chamada(s) de IA.",
  "batch.grouped":
    "Achados do mesmo arquivo são corrigidos juntos, numa chamada só.",
  "batch.costHint":
    "Cada chamada consome tokens do provedor configurado. Com o engine de agente, cada uma também clona o repositório — o que leva alguns minutos por arquivo.",
  "batch.start": "Gerar {n} correção(ões)",
  "batch.generating": "Gerando correções… {done}/{total}",
  "batch.summary": "{done} pronta(s) de {total}",
  "batch.cancel": "Cancelar geração",
  "batch.cancelHint": "O que já ficou pronto continua salvo.",
  "batch.confirmClose":
    "As correções ainda estão sendo geradas. Fechar agora cancela o que falta. Continuar?",
  "batch.statusQueued": "Na fila",
  "batch.statusRunning": "Gerando…",
  "batch.statusDone": "Pronta",
  "batch.statusError": "Erro",
  "batch.statusCancelled": "Cancelada",
  "batch.groupedWith":
    "Corrigida junto com {n} outro(s) achado(s) deste mesmo arquivo, numa única alteração.",
  "batch.noChangeItem":
    "A IA não propôs alteração neste arquivo — ele fica de fora do PR.",
  "batch.noChangeCount":
    "{n} arquivo(s) sem alteração proposta pela IA — não entram no PR.",
  "batch.openPr": "Abrir 1 PR com {n} arquivo(s)",
  "batch.waiting": "Aguarde as correções…",
  "batch.prOpened": "PR #{number} aberto com {files} arquivo(s).",
  "batch.nFindings": "{n} achado(s)",
  "batch.nFiles": "{n} arquivo(s)",
  "batch.genFailed": "Falha ao gerar.",
  "batch.prFailed": "Falha ao abrir o PR.",

  // ---- Ajuda contextual e seções da tela de resultados ----
  "help.overview": "Visão geral",
  "help.overviewText":
    "Resumo do que a análise encontrou. Comece pelas correções de código — é onde você resolve os problemas e abre um PR.",
  "help.fixes": "Correções de segurança",
  "help.fixesText":
    "Reúne as vulnerabilidades do scanner (SAST) e os achados da revisão por IA (regra de negócio, IDOR/autorização, lógica multi-arquivo). Os achados da IA que repetiriam um do SAST são descartados. Selecione o que quer resolver e gere correções com IA — cada uma pode virar um Pull Request.",
  "help.batch": "Correção em lote",
  "help.batchText":
    "Selecione os achados e gere as correções de uma vez. No fim, você abre um único Pull Request com todas. Ou use “Corrigir com IA” em cada card para uma só.",
  "help.deps": "Dependências (SCA)",
  "help.depsText":
    "Pacotes com CVE conhecido detectados pela análise de composição de software. A correção é atualizar para a versão corrigida indicada.",
  "help.threats": "Ameaças e requisitos",
  // A descrição antiga ("levanta ameaças plausíveis…") deixava a aba parecer um
  // segundo lugar onde se lê achado. Ela não é: é o CONTRATO que a Fase 3
  // confere. Quem procura problema tem de ser mandado para Correções.
  "help.threatsText":
    "O que a IA entendeu do contexto que você descreveu: ameaças plausíveis (STRIDE, LGPD, OWASP) e os requisitos técnicos que as mitigam. Esta lista não traz problemas do seu código — é o contrato contra o qual a Fase 3 confere o repositório. As regras violadas aparecem em Correções, marcadas com o id do requisito (R-01, R-02…); as que não deu para verificar no código ficam listadas lá embaixo, na mesma aba. Vale a leitura: se os requisitos saírem genéricos, é sinal de que o contexto do sistema precisa de mais detalhe.",
  "help.skills": "Validação de skills",
  "help.skillsText":
    "Cada skill/prompt é checada contra prompt-injection, exfiltração de dados e desvio de política. O veredito indica se é seguro usá-la.",
  "help.batchModal": "Como funciona",
  "help.batchModalText":
    "Os achados são agrupados por arquivo: cada arquivo recebe UMA correção que resolve todos os problemas dele de uma vez — assim uma correção não sobrescreve a outra. Ao final, você abre um único Pull Request com todos os arquivos.",
  "help.customizeFix": "Personalize a correção",
  "help.customizeFixText":
    "Oriente a IA: biblioteca a usar, manter a assinatura de uma função, seguir um padrão do projeto, etc. A IA recebe o arquivo inteiro + o contexto do erro e corrige só o problema de segurança, sem mudar a lógica de negócio.",
  "fix.instructionsPlaceholder":
    "Ex.: use consultas parametrizadas do driver pg, mantenha a assinatura da função e o estilo do arquivo. Não altere as outras rotas.",

  "results.done": "Análise concluída.",
  "results.inProgress": "Análise em andamento…",
  "results.sections": "Seções",
  "results.bySeverity": "Achados por severidade",
  "results.ctaTitle": "{n} correção(ões) de segurança a aplicar",
  "results.ctaSub":
    "{n} crítica(s). Gere correções com IA e abra um Pull Request.",
  "results.goToFixes": "Ir para correções",
  "results.rowFixes": "Correções de segurança",
  "results.rowDeps": "Dependências (SCA)",
  "results.rowRequirements": "Requisitos",
  "results.rowSkills": "Skills",
  "results.nFixes": "{n} correção(ões)",
  "results.nCves": "{n} com CVE",
  "results.nThreats": "{threats} ameaças · {reqs} requisitos",
  "results.nSkills": "{n} validada(s)",
  "results.selectItems": "Selecione os itens e aplique correções com IA.",
  "results.includesAi": "Inclui {n} achado(s) da revisão por IA.",
  "results.waitingPrevious": "Aguardando as fases anteriores…",
  "results.phaseFailed": "Falha nesta fase.",
  "results.newAnalysisLink": "← Nova análise",

  "deps.title": "Dependências · SCA",
  "deps.subtitle": "Pacotes vulneráveis e a versão que corrige.",
  "deps.scanning": "Escaneando as dependências…",
  "deps.empty": "Nenhuma dependência vulnerável encontrada. 🎉",
  "deps.notRun": "O SCA ({engine}) não foi executado.",
  "deps.notRunHint": "As dependências não foram verificadas.",

  "threats.modeling": "Modelando as ameaças…",
  "threats.requirements": "Requisitos técnicos de segurança",
  "unverified.title": "Regras declaradas que não deu para verificar",

  "skills.subtitle": "Segurança de skills/prompts enviados.",
  "skills.validating": "Validando as skills…",
  "skills.empty": "Nenhuma skill enviada para validação.",
  "skills.verdictApproved": "Validada",
  "skills.verdictReview": "Requer revisão",
  "skills.verdictRejected": "Reprovada",

  "fixes.noScannerTitle": "Nenhum analisador de código rodou.",
  "card.businessRule": "Regra de negócio",

  // ---- Mensagens escritas pelo SERVIDOR e persistidas no JSONB ----
  // Gravadas no idioma de quem pediu a análise (lib/jobs.ts, lib/tasks.ts).
  "job.orphan":
    "A análise foi interrompida antes de começar (o servidor reiniciou). Rode de novo — nada foi perdido no repositório.",
  "job.stale":
    "A análise não deu sinal de vida por tempo demais e foi encerrada (provável reinício do servidor durante o processamento).",
  "job.phaseFailed": "Falha na etapa.",
  "job.unexpected": "Falha inesperada na análise.",
  "scan.noRepo": "Nenhum repositório informado.",
  "scan.sastOff": "SAST desligado por configuração (SAST_ENGINE=none).",
  "scan.scaOff": "SCA desligado por configuração (SCA_ENGINE=none).",
  "scan.sastNotRun": "O SAST ({engine}) não foi executado.",

  // ---- Explicação de dependência vulnerável (lib/enrich.ts, sem IA) ----
  "depExplain.title": "Dependência vulnerável: {pkg}",
  "depExplain.whatItIs":
    "A versão em uso ({version}) tem uma vulnerabilidade conhecida, registrada como {cve}.",
  "depExplain.whyItMatters":
    "Código de terceiro roda com os mesmos privilégios do seu. Vulnerabilidade com CVE público já tem exploit conhecido e varredores automáticos procuram por ela.",
  "depExplain.howToFix":
    "Atualize `{pkg}` para {version} ou superior. Se for dependência transitiva, force a resolução no lockfile.",
  "depExplain.noFixedVersion":
    "Ainda não há versão corrigida. Avalie substituir a dependência, isolar o uso dela, ou acompanhar o avanço do {cve}.",

  // ---- Validação de skills: checagens e heurísticas (lib/skills.ts) ----
  "skillCheck.scope": "Contém objetivo/escopo declarado",
  "skillCheck.noExfiltration": "Sem instruções de exfiltração de dados",
  "skillCheck.noPolicyBypass": "Sem tentativa de desvio de política",
  "skillCheck.noCommandExec": "Sem execução de comandos externos",
  "skillFinding.heuristicDesc":
    'Padrão suspeito detectado por heurística: "{match}".',
  "skillFinding.promptInjection.title":
    "Instrução de sobreposição de política (prompt injection)",
  "skillFinding.promptInjection.fix":
    "Remover instruções que peçam ao modelo ignorar regras do sistema; skills não devem sobrepor a política.",
  "skillFinding.dataExfiltration.title": "Possível exfiltração de dados/segredos",
  "skillFinding.dataExfiltration.fix":
    "Proibir leitura de segredos e chamadas de rede dentro de skills; aplicar allowlist de operações.",
  "skillFinding.backdoor.title": "Execução de código/comando embutida",
  "skillFinding.backdoor.fix":
    "Skills não devem executar comandos ou avaliar código arbitrário. Remover o trecho.",
  "skillFinding.policyBypass.title": "Tentativa de desvio de política",
  "skillFinding.policyBypass.fix":
    "Remover linguagem que tente desabilitar salvaguardas do modelo.",
  "skillFinding.aiTitle": "Achado da IA",
  "skillFinding.aiRecommendation": "Revisar o trecho apontado.",

  // ---- Erros de API (chaves devolvidas em errorKey) ----
  "err.unauthenticated": "Sessão expirada. Entre novamente.",
  "err.forbidden": "Você não tem permissão para esta ação.",
  "err.notFound": "Não encontrado.",
  "err.conflict": "Conflito com um registro existente.",
  "err.tooManyRequests": "Muitas requisições. Aguarde alguns instantes.",
  "err.server": "Erro no servidor. Tente novamente.",
  "err.githubTokenRequired":
    "Informe um token do GitHub com permissão de escrita para abrir o pull request.",
  "err.schemaOutdated":
    "O banco de dados está desatualizado em relação à aplicação. Avise quem administra: faltam migrações.",
  "err.badRequest": "Dados inválidos.",
  "err.network": "Sem conexão com o servidor.",
  // Mensagens específicas de rota: sem chave própria elas cairiam no genérico
  // por status ("Dados inválidos.") e o usuário perderia o motivo real.
  "err.csrf": "Token CSRF inválido.",
  "err.emailTaken": "Já existe um usuário com este e-mail.",
  "err.currentPasswordRequired":
    "Informe a senha atual para alterar e-mail ou senha.",
  "err.wrongCurrentPassword": "Senha atual incorreta.",
  "err.cannotChangeOwnRole": "Não é possível alterar o próprio papel.",
  "err.cannotDeleteOwnAccount": "Não é possível excluir a própria conta.",
  "err.badExportFormat": "Formato inválido. Use sarif, csv ou json.",
  "err.threatModelFailed": "Falha ao gerar a modelagem de ameaças.",
  "err.skillsValidationFailed": "Falha ao validar as skills.",

  // ---- Relatório ----
  "report.title": "Sumário executivo",
  "report.docTitle": "StarGuard — Relatório de Segurança",
  "report.project": "Projeto",
  "report.back": "Voltar",
  "report.print": "Exportar / Imprimir",
  "report.bySeverity": "Vulnerabilidades por severidade",
  "report.requirements": "Requisitos técnicos de segurança (Fase 1)",
  "report.skills": "Validação de skills (Fase 2)",
  "report.skillRejected": "Reprovada",
  "report.skillReview": "Revisar",
  "report.skillApproved": "Validada",
  "report.findingCount": "{n} achado(s)",
  "report.noSkills": "Nenhuma skill validada nesta análise.",
  "report.findings": "Achados de segurança (Fase 3)",
  "report.noFindings": "Sem achados de código/dependências.",
  "report.fixedIn": "corrige em {v}",
  "report.aiReview": "Revisão por IA · regras de negócio (Fase 3)",
  "report.noExtraFindings": "Sem achados adicionais além do SAST/SCA.",
  "report.reviewNotRun": "Revisão por IA não executada.",
  "report.fixes": "Correções aplicadas (Fase 4)",
  "report.fixesOnDemand":
    "As correções são geradas sob demanda, achado a achado, na tela de resultados — nenhuma é gerada automaticamente.",
  "report.footer": "Gerado por StarGuard · Copilot de Segurança",
  "report.metaAnalysis": "Análise",
  "report.metaRunAt": "Executada em",
  "report.metaPrintedAt": "Emitida em",
  "report.metaEngines": "Motores",
  "report.loadFailed": "Falha ao carregar o relatório.",

  // ---- Eventos da trilha de auditoria (enum de domínio, FEAT-04) ----
  "auditEvent.login.success": "Login",
  "auditEvent.login.fail": "Login falho",
  "auditEvent.login.ratelimited": "Login bloqueado (limite)",
  "auditEvent.logout": "Logout",
  "auditEvent.token.refresh": "Sessão renovada",
  "auditEvent.session.revoked": "Sessões encerradas",
  "auditEvent.analyze.start": "Análise iniciada",
  "auditEvent.finding.status": "Achado atualizado",
  "auditEvent.fix.generate": "Correção gerada",
  "auditEvent.fix.cached": "Correção reaproveitada",
  "auditEvent.analyze.done": "Análise concluída",
  "auditEvent.analysis.delete": "Análise excluída",
  "auditEvent.analysis.export": "Achados exportados",
  "auditEvent.pr.open": "PR aberto",
  "auditEvent.pr.batch": "PR em lote",
  "auditEvent.token.create": "Token criado",
  "auditEvent.token.delete": "Token removido",
  "auditEvent.account.update": "Conta atualizada",
  "auditEvent.user.create": "Usuário criado",
  "auditEvent.user.role.update": "Papel alterado",
  "auditEvent.user.delete": "Usuário excluído",

  // ---- Governança · monitoramento e análises globais ----
  "monitoring.subtitle": "Trilha de auditoria de tudo o que acontece na plataforma.",
  "monitoring.searchPlaceholder": "Buscar por evento ou detalhe…",
  "monitoring.category": "Categoria",
  "monitoring.empty": "Nenhum registro para os filtros atuais.",
  "monitoring.colWhen": "Quando",
  "monitoring.colEvent": "Evento",
  "monitoring.colDetail": "Detalhe",
  "monitoring.colOrigin": "Origem",
  "monitoring.loadFailed": "Falha ao carregar os logs.",
  "auditCategory.auth": "Autenticação",
  "auditCategory.analise": "Análises",
  "auditCategory.pr": "Pull Requests",
  "auditCategory.conta": "Conta",
  "auditCategory.usuario": "Usuários",
  "auditCategory.sistema": "Sistema",
  "adminAnalyses.subtitle": "Todas as análises de todos os usuários.",
  "adminAnalyses.empty": "Nenhuma análise encontrada.",

  // ---- Governança · usuários ----
  "adminUsers.subtitle": "Todas as contas — gerencie papéis e acessos.",
  "adminUsers.searchPlaceholder": "Buscar por nome ou e-mail…",
  "adminUsers.empty": "Nenhum usuário encontrado.",
  "adminUsers.colUser": "Usuário",
  "adminUsers.colPrs": "PRs",
  "adminUsers.colLastActivity": "Última atividade",
  "adminUsers.you": "você",
  "adminUsers.deleteUser": "Excluir usuário",
  "adminUsers.cannotDeleteSelf": "Você não pode excluir a si mesmo",
  "adminUsers.deleteConfirm":
    "Excluir \"{name}\"? A conta será desativada (soft delete) e a pessoa não poderá mais entrar. As análises dela permanecem no histórico.",
  "adminUsers.loadFailed": "Falha ao carregar os usuários.",
  "adminUsers.roleFailed": "Falha ao alterar o papel.",
  "adminUsers.deleteFailed": "Falha ao excluir o usuário.",

  // ---- Governança · painel ----
  "admin.dashTitle": "Painel global",
  "admin.dashSubtitle":
    "Visão consolidada de todos os usuários, análises e correções.",
  "admin.metricsFailed": "Falha ao carregar métricas.",
  "admin.last7d": "nos últimos 7 dias",
  "admin.running": "em andamento",
  "admin.doneCount": "concluídas",
  "admin.errorCount": "com erro",
  "admin.sumOfAll": "Somatório de todas as análises.",
  "admin.noFindings": "Nenhum achado registrado ainda.",
  "admin.usersHint": "{n} conta(s) — ver métricas por usuário",
  "admin.analysesHint": "{n} análise(s) de todos os usuários",

  // ---- Conta (corpo da tela) ----
  "account.kicker": "Configurações",
  "account.subtitle": "Seus dados de acesso e os tokens do GitHub.",
  "account.basics": "Dados básicos",
  "account.name": "Nome",
  "account.login": "Login (e-mail)",
  "account.loginHelp": "Alterar o login",
  "account.loginHelpText":
    "Este e-mail é o seu login. Para alterá-lo, confirme com a senha atual. As próximas entradas usam o novo e-mail.",
  "account.currentPasswordToConfirm": "Senha atual (para confirmar o novo login)",
  "account.currentPasswordPlaceholder": "sua senha atual",
  "account.saveProfile": "Salvar dados",
  "account.changePassword": "Alterar senha",
  "account.currentPassword": "Senha atual",
  "account.newPassword": "Nova senha",
  "account.confirmNewPassword": "Confirmar nova senha",
  "account.min8": "mínimo 8 caracteres",
  "account.tokens": "Tokens do GitHub",
  "account.tokensHelp": "Tokens cifrados",
  "account.tokensHelpText":
    "Os tokens são guardados cifrados (AES-256-GCM) e nunca voltam em texto puro. Mostramos apenas o nome e os últimos 4 caracteres. Você pode ter vários e escolher qual usar ao iniciar uma análise.",
  "account.tokensHint":
    "Salvos cifrados; usados para clonar repositórios privados e abrir PRs.",
  "account.token": "Token",
  "account.tokenNamePlaceholder": "Ex.: PAT pessoal",
  "account.tokenPlaceholder": "ghp_…",
  "account.save": "Salvar",
  "account.noTokens": "Nenhum token salvo ainda.",
  "account.createdAt": "Criado",
  "account.lastUsed": "Último uso",
  "account.remove": "Remover",
  "account.nothingToUpdate": "Nada para atualizar.",
  "account.needCurrentPassword":
    "Informe a senha atual para alterar o login (e-mail).",
  "account.profileUpdated": "Dados atualizados.",
  "account.updateFailed": "Falha ao atualizar.",
  "account.enterCurrentPassword": "Informe a senha atual.",
  "account.newPasswordTooShort": "A nova senha precisa de ao menos 8 caracteres.",
  "account.confirmMismatch": "A confirmação não confere.",
  "account.passwordChanged": "Senha alterada com sucesso.",
  "account.changePasswordFailed": "Falha ao alterar a senha.",
  "account.tokenSaved": "Token salvo com segurança (cifrado).",
  "account.saveTokenFailed": "Falha ao salvar o token.",
  "account.removeTokenConfirm":
    "Remover este token? Análises futuras deixarão de poder usá-lo.",
  "account.removeTokenFailed": "Falha ao remover o token.",
  "account.loadTokensFailed": "Falha ao carregar os tokens.",
  "account.language": "Idioma da interface",
  "account.languageHint":
    "Vale para a interface e para os textos gerados por IA nas próximas análises.",

  // ---- Analisadores (seletor da tela, `starguard list`, árvore do VS Code) ----
  // Nome e descrição de cada analisador independente. A MESMA chave serve as
  // três interfaces: o cartão do painel, a linha do terminal e o item da
  // árvore do editor.
  "analyzer.threat.name": "Modelagem de ameaças",
  "analyzer.threat.desc":
    "Lê a descrição do sistema e levanta ameaças e requisitos de segurança. Não precisa de código.",
  "analyzer.sast.name": "Vulnerabilidades de código",
  "analyzer.sast.desc":
    "Procura padrões inseguros no código-fonte com o Opengrep/Semgrep.",
  "analyzer.sca.name": "Dependências vulneráveis",
  "analyzer.sca.desc":
    "Procura CVE conhecido nos pacotes declarados, com o Trivy.",
  "analyzer.business.name": "Regras de negócio",
  "analyzer.business.desc":
    "Revisão por IA do que o scanner não pega: regra de negócio violada, IDOR e autorização.",
  "analyzer.skills.name": "Skills e prompts",
  "analyzer.skills.desc":
    "Analisa skills em busca de prompt injection, exfiltração e backdoor.",

  // Por que um analisador ficou de fora. Nunca some da lista em silêncio: a
  // tela, o terminal e o editor mostram o item desabilitado COM o motivo.
  "analyzer.reason.not_selected": "Não selecionado nesta execução.",
  "analyzer.reason.no_workspace":
    "Precisa de código: informe um repositório ou um diretório.",
  "analyzer.reason.no_input": "Faltou a entrada que este analisador consome.",
  "analyzer.reason.binary_missing":
    "O executável {bin} não foi encontrado neste computador.",
  "analyzer.reason.engine_off": "Desligado por configuração.",
  "analyzer.reason.no_ai_key":
    "Precisa de uma chave de IA e nenhuma foi configurada.",

  // Rodou, mas com menos contexto do que teria em conjunto. É dito em voz
  // alta: um resultado degradado silencioso passa por resultado completo.
  "analyzer.degraded.threat":
    "Sem a modelagem de ameaças nesta execução: não havia requisitos declarados para conferir.",
  "analyzer.degraded.sast":
    "Sem o analisador de código nesta execução: os achados não foram deduplicados contra ele.",
  "analyzer.degraded.sca":
    "Sem o analisador de dependências nesta execução: os achados não foram deduplicados contra ele.",

  // Por que não dá para propor correção deste achado.
  "fix.cannot.noFile": "O achado não aponta um arquivo para corrigir.",
  "fix.cannot.noSnippet":
    "O achado não traz nem trecho nem localização — não há o que corrigir com segurança.",
  "fix.cannot.noWorkspace":
    "Sem acesso ao código: informe o repositório ou abra o projeto.",

  // ---- Árvore lateral do VS Code ----
  // Rótulo de estado fica CURTO de propósito: o VS Code trunca a descrição
  // com reticências, e meia frase cortada não informa nada. O motivo inteiro
  // vai no tooltip, que não trunca.
  "tree.state.unavailable": "indisponível",
  "tree.state.running": "analisando…",
  "tree.state.clean": "nada encontrado",
  "tree.state.failed": "falhou",
  "tree.findings.one": "1 achado",
  "tree.findings.many": "{n} achados",
  "tree.total.one": "1 achado no total",
  "tree.total.many": "{n} achados no total",
  "tree.signedInAs": "Conectado como {email}",

  // Cada analisador bloqueado oferece a SAÍDA, não só o diagnóstico. Dizer
  // "falta a descrição do sistema" e parar aí deixa a pessoa procurando onde
  // se configura isso.
  "tree.action.describeSystem": "Descrever o sistema…",
  "tree.action.installBinary": "Como instalar o {bin}",
  "tree.action.openFolder": "Abrir uma pasta…",
  "tree.action.openSkill": "Abrir o arquivo da skill…",
  "tree.action.useAccountAi": "Usar a IA da minha conta…",
  "tree.action.enable": "Habilitar nas configurações…",

  // ---- Seletor de analisadores (Tela 1) ----
  "select.title": "O que analisar",
  "select.hint":
    "Cada análise roda por conta própria. Escolha só o que precisa agora — o resto não gasta tempo nem IA.",
  "select.all": "Selecionar tudo",
  "select.none": "Limpar seleção",
  "select.chosen": "{n} de {total} selecionados",
  "select.unavailable": "Indisponível",
  "select.needsRepo": "Precisa de repositório",
  "select.fixes": "Corrige o que encontra",
  "select.empty": "Escolha ao menos um analisador para começar.",
  "select.loading": "Verificando o que está disponível…",
  "select.notRunHere": "Não foi executado nesta análise.",

  // ---- App de terminal (packages/cli) ----
  // O terminal fala os mesmos três idiomas que a tela: `--lang` escolhe.
  "cli.clean": "limpo",
  "cli.noFindings": "Nenhum achado. 🎉",
  "cli.col.severity": "SEV",
  "cli.col.location": "ARQUIVO",
  "cli.col.rule": "REGRA",
  "cli.col.title": "PROBLEMA",
  "cli.failOnHit": "{n} achado(s) em {sev} ou pior — saindo com código 1.",
  "cli.failOnClear": "Nada em {sev} ou pior.",
  "cli.sarifWritten": "SARIF gravado em {file}",
  "cli.list.title": "Analisadores disponíveis",
  "cli.doctor.analyzers": "Analisadores",

  "cli.doctor.aiRemote": "pela conta ({server})",
  "cli.doctor.aiLocal": "chave local",
  "cli.doctor.aiNone": "sem chave local e sem login — rode `starguard login`",

  // ---- Hook de pre-commit ----
  "cli.hook.instalado": "Hook de pre-commit instalado.",
  "cli.hook.atualizado": "Hook de pre-commit atualizado.",
  "cli.hook.removido": "Hook de pre-commit removido.",
  "cli.hook.blockHint":
    "Ele AVISA e deixa commitar. Para bloquear: git config starguard.hookBlocks true",
  "cli.hook.notARepo": "Este diretório não é um repositório git.",
  "cli.hook.foreign":
    "Já existe um hook de pre-commit de outra ferramenta em {path}. Não vou sobrescrevê-lo — chame `starguard scan . --only sast,sca --no-ai` de dentro dele.",
  "cli.hook.notInstalled": "Não há hook do StarGuard instalado aqui.",

  // ---- Consentimento da IA pela conta (o código sai da máquina) ----
  "consent.title": "Usar a IA pela sua conta StarGuard?",
  "consent.detail":
    "Trechos do código analisado serão enviados ao servidor do StarGuard e de lá ao modelo de IA. O servidor registra quem pediu, qual repositório e quanto custou — NUNCA o código, que é descartado após a análise. Se preferir que nada saia desta máquina, cancele e configure uma chave de IA local.",
  "consent.accept": "Enviar e continuar",

  "auth.required":
    "Entre com a sua conta StarGuard para usar a extensão. Se ainda não tem conta, use 'StarGuard: solicitar acesso'.",
  "cli.fix.noTarget": "Nenhum achado corrigível com os filtros informados.",
  "cli.fix.noFixer": "este analisador não propõe correção.",
  "cli.fix.noChange": "a correção não alterou nada — nada a aplicar.",
  "cli.fix.dryRun": "simulação: use --write para gravar no disco.",
  "cli.fix.applied": "aplicado.",
  "cli.fix.total": "{n} correção(ões) gravada(s).",
  "cli.help":
    "  starguard — análise de segurança no terminal\n\n  USO\n    starguard scan [alvo]        alvo = diretório (padrão: .) ou URL do GitHub\n    starguard skills <arquivos>  valida skills, sem precisar de repositório\n    starguard fix [ids]          propõe correção; sem id, corrige o mais grave\n    starguard doctor             o que está instalado e configurado\n    starguard list               os analisadores e o que cada um faz\n\n  ESCOLHA O QUE RODAR\n    --only sast,sca              só estes analisadores\n    --skip business              todos menos estes\n\n  SAÍDA\n    --json                       resultado estruturado (chaves estáveis)\n    --sarif <arquivo>            SARIF para o GitHub Code Scanning\n    --fail-on critical|high|…    sai com código 1 se houver achado assim\n    --lang pt-BR|en|es           idioma da saída\n\n  CORREÇÃO\n    --write                      grava no disco (o padrão é simular)\n    --all --severity high        corrige tudo a partir desta severidade\n\n  OUTROS\n    --no-ai                      não usa modelo nenhum\n    --token <t>                  token do GitHub (ou GITHUB_TOKEN)\n    -d, --description <texto>    descrição do sistema (ameaças/regras)\n\n  CÓDIGOS DE SAÍDA\n    0  nada acima do limiar     1  achados     2  falha de execução",

  // ---- OAuth: consentimento e dispositivos conectados ----
  "oauth.client.vscode": "StarGuard para VS Code",
  "oauth.client.cli": "StarGuard no terminal",
  "oauth.client.unknown": "Aplicativo desconhecido",
  "oauth.scope.analyze": "Analisar o código que você abrir",
  "oauth.scope.fix": "Propor correções e abrir Pull Requests",
  "oauth.scope.profile": "Ver seu nome e e-mail",
  "oauth.title": "Conectar {client}",
  "oauth.subtitle": "Entrando como {email}. Ao autorizar, este aplicativo poderá:",
  "oauth.approve": "Autorizar",
  "oauth.deny": "Cancelar",
  "oauth.done": "Pronto. Pode voltar para {client}.",
  // O caminho de volta ao editor, quando o salto automático não acontece.
  "oauth.manualTitle": "Não abriu o editor?",
  "oauth.manualHint":
    "Copie o código abaixo e cole no StarGuard, em «Colar o código».",
  "oauth.copy": "Copiar",
  "oauth.copied": "Copiado",

  // ---- Login visto de DENTRO do editor ----
  "auth.waiting": "StarGuard: conclua a autorização no navegador.",
  "auth.pasteCode": "Colar o código",
  "auth.pastePrompt": "Cole o código mostrado no navegador",
  "auth.pasteInvalid": "Isto não parece o código do navegador.",
  "auth.cancelled": "Autorização cancelada.",
  "auth.readAccountFailed": "Não foi possível ler a conta.",
  "auth.mismatch": "A resposta não corresponde a este pedido de login.",
  "auth.timeout": "Tempo esgotado esperando a autorização no navegador.",
  "auth.failed": "StarGuard: não foi possível entrar. {erro}",
  "auth.connected": "StarGuard: conectado como {email}.",
  "auth.signedOut":
    "StarGuard: desconectado deste editor. Para encerrar a sessão no servidor, revogue o dispositivo em Conta.",

  "oauth.opening": "Autorizado. Abrindo o {client}…",
  "oauth.openApp": "Abrir o {client}",
  "oauth.openHint":
    "Se nada acontecer em alguns segundos, clique no botão acima: o navegador só abre um aplicativo depois de um clique seu. Ele vai pedir confirmação, e o editor também.",
  "oauth.openExpires": "Este link vale por 2 minutos.",
  "oauth.denied": "Autorização cancelada. Nada foi conectado.",
  "oauth.failed": "Não foi possível concluir a autorização.",
  "oauth.invalidRequest":
    "Pedido de autorização inválido. Ele não veio de um aplicativo reconhecido — não autorize.",
  "oauth.warning":
    "Autorize apenas se VOCÊ acabou de iniciar esta conexão a partir do aplicativo.",
  "oauth.devices": "Dispositivos conectados",
  "oauth.devicesHint":
    "Aplicativos com acesso à sua conta. Revogue o que você não reconhecer — o acesso cai na hora.",
  "oauth.devicesEmpty": "Nenhum dispositivo conectado.",
  "oauth.lastUsed": "Último uso: {when}",
  "oauth.connectedAt": "Conectado em {when}",
  "oauth.revokeDevice": "Revogar",
  "oauth.revokeConfirm":
    "Revogar o acesso deste dispositivo? Ele precisará entrar de novo.",
  "oauth.revoked": "Acesso revogado.",
  "oauth.revokeFailed": "Não foi possível revogar o acesso.",
  "err.oauthClient": "Aplicativo não reconhecido.",
  "err.oauthRedirect": "Destino de retorno não permitido para este aplicativo.",
  "err.oauthPkce": "Este aplicativo usa um método de segurança que não aceitamos.",

  // ---- Autenticação no terminal ----
  "cli.login.opening": "Abrindo o navegador para você entrar…",
  "cli.login.orOpen": "Se ele não abrir, acesse:",
  "cli.login.done": "Conectado como {email}.",
  "cli.logout.done": "Credencial removida deste computador.",
  "cli.logout.hint":
    "A sessão no servidor segue ativa até expirar. Se você suspeita de vazamento, revogue em Conta → Dispositivos conectados.",
  "cli.whoami.anonymous": "Não conectado. Rode `starguard login`.",
  "cli.whoami.expired":
    "Sessão encerrada (revogada, senha alterada ou credencial reutilizada). Rode `starguard login`.",
  "cli.whoami.as": "Conectado como {email}.",
} as const;

export type MessageKey = keyof typeof PT_BR;

/**
 * Inglês e espanhol são COMPLETOS por tipo (`Record`, não `Partial`): chave
 * nova em português não compila até ser traduzida nos três idiomas.
 */
const EN: Record<MessageKey, string> = {
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
  "role.change": "Change role",
  "role.cannotChangeSelf": "You can't change your own role",

  "meta.title": "StarGuard | Security Copilot",
  "meta.description":
    "AI-assisted security platform for secure software development — end-to-end, headless, AI-native DevSecOps.",

  "common.retry": "Try again",
  "common.refresh": "Refresh",
  "common.cancel": "Cancel",
  "common.details": "See details",
  "common.close": "Close",
  "common.open": "Open",
  "common.report": "Report",
  "common.new": "New",
  "common.loading": "Loading…",
  "common.language": "Language",
  "common.moreInfo": "More information",
  "common.total": "{n} in total",
  "common.previousPage": "Previous page",
  "common.nextPage": "Next page",

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
  "phase.skipped": "not run",

  "results.kicker": "Analysis",
  "results.doneSubtitle": "Analysis complete. Start with the code fixes.",
  "results.runningSubtitle": "Running the 4 phases in real time…",
  "results.degraded": "Unstable connection — still retrying in the background.",
  "results.refreshNow": "Refresh now",
  "results.phasesFailed": "{n} phase(s) failed:",
  "results.goToPhase": "See details",
  "results.loadFailed": "Failed to load the analysis.",
  "results.progressLabel": "progress",
  "tab.overview": "Overview",
  "tab.fixes": "Fixes",
  "tab.deps": "Dependencies",
  "tab.requirements": "Requirements",
  "tab.skills": "Skills",
  "tab.ariaLabel": "Analysis sections",

  "fixes.searchPlaceholder": "Search by file, rule or CWE…",
  "fixes.allSeverities": "Any severity",
  "fixes.allSources": "Any source",
  "fixes.sourceSast": "SAST",
  "fixes.sourceAi": "AI review",
  "fixes.filterOpen": "Open ({n})",
  "fixes.filterResolved": "Resolved ({n})",
  "fixes.filterAll": "All",
  "deps.installed": "installed",
  "deps.fixedIn": "fixed in",
  "deps.manifestHint": "File the fix edits",
  "deps.fixWithAi": "Fix with AI",
  "deps.noFixedVersion":
    "No fixed version has been published for this package yet — there is nothing to propose without inventing it.",
  "deps.noManifest":
    "Could not identify the file where the dependency is declared.",
  "deps.selectPage": "Select the {n} on this page",
  "deps.selectAllFiltered": "Select all {n}",
  "deps.fixSelected": "Fix {n} with AI",
  "deps.lockWarningWithCmd":
    "The fix changes {manifest}; the lock file ({lockfile}) is NOT regenerated automatically — run `{cmd}` and include the lock in the commit before merging.",
  "deps.lockWarning":
    "The fix changes {manifest}; the lock file ({lockfile}) is NOT regenerated automatically — regenerate it with the project's package manager before merging.",
  "fixes.selectPage": "Select the {n} on this page",
  "fixes.selectAllFiltered": "Select all {n}",
  "fixes.clearAll": "Clear selection",
  "fixes.selectedCount": "{n} of {total} selected",
  "fixes.fixWithAi": "Fix {n} with AI",
  "fixes.showMore": "Show {n} more of {total} remaining",
  "fixes.emptyFilters": "No findings match the current filters.",
  "fixes.emptyResolved": "Every finding in this analysis has been resolved. 🎉",
  "fixes.emptyNoResolved": "No resolved findings yet.",
  "fixes.empty": "No security fixes found. 🎉",
  "fixes.analyzing": "Analyzing the source code…",
  "fixes.noScanner":
    "No code analyzer ran. {reasons} This does not mean the repository is clean — it means it was not analyzed.",
  "fixes.coverage":
    "The AI review read {reviewed} of {eligible} eligible files (prioritizing auth, routes, database and the files SAST flagged). SAST and SCA analyzed the whole repository.",
  "fixes.coverageTruncated": "{n} file(s) were truncated for size.",

  "card.line": "line {n}",
  "card.technicalDetails": "Technical details",
  "card.technicalHint": "Code snippet and the tool's original text",
  "card.technicalHintWithAttack":
    "Attack path, code snippet and the tool's original text",
  "card.attackScenario": "How it would be exploited",
  "card.originalText": "Tool's original text",
  "card.howToFix": "How to fix",
  "card.suggestion": "Suggested fix",
  "card.recommendation": "Recommendation",
  "card.aiGenerated":
    "AI-generated from the analysed repository — check it before treating this as the tool's verdict.",
  "card.confidenceMedium": "medium confidence",
  "card.confidenceMediumHint":
    "The AI review wasn't sure about this finding. Double-check before acting.",
  "card.openOnGitHubHint":
    "Open on GitHub (current repository code — it may have changed since the analysis)",
  "filter.confidence": "Confidence",
  "filter.confidenceAll": "Any",
  "filter.confidenceHigh": "High only",
  "filter.severity": "Severity",
  "filter.source": "Source",
  "filter.byStatus": "Filter by state",
  "card.fixWithAi": "Fix with AI",
  "card.viewFix": "View fix",
  "card.markFixed": "Already fixed",
  "card.markFalsePositive": "False positive",
  "card.reopen": "Reopen",
  "card.selectToFix": 'Select "{title}" to fix',

  "fix.title": "Fix with AI",
  "fix.apply": "Apply the fix",
  "fix.applied": "Fix applied.",
  "fix.problem": "The problem",
  "fix.instructions": "Instructions for the AI (optional)",
  "fix.generate": "Generate fix",
  "fix.regenerate": "Regenerate with these instructions",
  "fix.regenerateHint":
    "Regenerating costs another AI call — the current fix is already saved.",
  "fix.confirmDiscard":
    "You wrote instructions and haven't generated the fix yet. Closing now discards what you typed. Close anyway?",
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
  "fix.guide":
    "Fix only this security problem, without changing business logic, keeping the file's style and indentation.",
  "fix.genericSuggestion": "Review the snippet against the recommendation.",

  "diff.showAll": "Show everything",
  "diff.onlyChanges": "Only what changed",
  "diff.fullFile": "Full file",
  "diff.viewDiff": "View diff",
  "diff.noChange": "no changes",
  "diff.unchangedLines": "{n} unchanged lines",

  "onb.kicker": "New analysis",
  "onb.title": "Let us analyze your project",
  "onb.subtitle":
    "Describe the system and hit start — StarGuard handles the 4 phases.",
  "onb.phases": "The 4 phases",
  "onb.projectName": "Project name",
  "onb.projectPlaceholder": "e.g. Patient Portal",
  "onb.optional": "Repository and skills",
  "onb.optionalHint": "Optional — connect GitHub and submit skills to validate",
  "onb.submit": "Start analysis",
  "onb.failed": "Could not start the analysis.",
  "phase1.label": "Threats",
  "phase1.desc":
    "Phase 1 · Models threats and security requirements from your context.",
  "phase2.label": "Skills",
  "phase2.desc":
    "Phase 2 · Validates skills/prompts against injection and exfiltration.",
  "phase3.label": "Software",
  "phase3.desc":
    "Phase 3 · SAST + SCA over the repository, ranked by severity.",
  "phase4.label": "Fix",
  "phase4.desc":
    "Phase 4 · Generates the fix and opens the Pull Request on GitHub.",

  "threatInput.label": "System context",
  "threatInput.help": "What to describe here",
  "threatInput.helpText":
    "Paste the system description, meeting notes or compliance requirements. This text becomes context for the 4 phases: threats, skill validation, scan and fix. E.g. sensitive data, login flows, payment integrations and business rules.",
  "threatInput.placeholder":
    "e.g. Telemedicine API storing health data (GDPR/LGPD). Email/password login, per-patient records, card payments (PCI). A doctor can only reach patients from their own clinic…",

  "repo.label": "GitHub repository",
  "repo.help": "Repository URL",
  "repo.helpText":
    "Only github.com is accepted (anti-SSRF allowlist). Without a repository, Phase 3 (code scan) does not run — the other phases proceed normally.",
  "repo.placeholder": "https://github.com/starbridge/my-project",
  "repo.invalid":
    "Invalid URL. Use the format https://github.com/owner/repository — only github.com is accepted.",
  "repo.tokenLabel": "Access token",
  "repo.tokenHelp": "Personal Access Token",
  "repo.tokenHelpText":
    "Needed only for private repositories. The token lives in memory during the job and is never persisted nor returned to the client.",
  "repo.tokenPlaceholder": "ghp_… (optional)",

  "tokenPicker.help": "GitHub token",
  "tokenPicker.helpText":
    "Needed only for private repositories / opening a PR. Pick a saved token (encrypted in your account) or type a new one. A new token can be saved to the account for reuse — always encrypted, never in plain text.",
  "tokenPicker.none": "None (public repository)",
  "tokenPicker.new": "+ New token…",
  "tokenPicker.saveToAccount": "Save to my account (encrypted)",
  "tokenPicker.namePlaceholder": "Token name (e.g. personal PAT)",

  "skillInput.label": "Skills to validate",
  "skillInput.help": "Skill validation",
  "skillInput.helpText":
    "Upload SKILL.md, prompts or templates so Phase 2 can check for prompt injection, data exfiltration and policy bypass. Optional.",
  "skillInput.namePlaceholder": "skill-name.md",
  "skillInput.contentPlaceholder":
    "Paste the skill/prompt content (SKILL.md, template…)",
  "skillInput.remove": "Remove skill",
  "skillInput.add": "+ Add skill",
  "skillInput.upload": "Upload files",

  "list.historyKicker": "History",
  "list.analysesTitle": "Analyses",
  "list.analysesSubtitle": "Your security analyses, newest first.",
  "list.searchAnalyses": "Search by project or repository…",
  "list.colProject": "Project",
  "list.colSeverities": "Severities",
  "list.colFindings": "Findings",
  "list.colStatus": "Status",
  "list.colCreated": "Created",
  "list.empty": "No analyses yet.",
  "list.startFirst": "Start the first one",
  "list.loadFailed": "Failed to load the analyses.",
  "list.prs": "{n} PR(s)",
  "list.openRepo": "Open repository",

  "newUser.title": "New user",
  "newUser.subtitle": "Set the access and role for the new account.",
  "newUser.help": "Create user",
  "newUser.helpText":
    "The user signs in with the e-mail and password set here. Superadmin sees everything from everyone; admin only sees their own history. The password is stored with an Argon2id hash.",
  "newUser.name": "Name",
  "newUser.namePlaceholder": "e.g. Maria Silva",
  "newUser.email": "E-mail",
  "newUser.emailPlaceholder": "person@company.com",
  "newUser.password": "Password",
  "newUser.passwordPlaceholder": "at least 8 characters",
  "newUser.passwordTooShort": "The password needs at least 8 characters.",
  "newUser.role": "Role",
  "newUser.roleAdminSub": "Only sees their own history",
  "newUser.roleSuperadminSub": "Sees everything from everyone",
  "newUser.submit": "Create user",
  "newUser.failed": "Failed to create the user.",
  "newUser.confirmDiscard":
    "You filled in the form and haven't created the user yet. Closing now discards what you typed. Close anyway?",

  "pipe.ariaLabel": "Progress of the 4 phases",
  "pipe.status.pending": "Waiting",
  "pipe.status.running": "Running",
  "pipe.status.done": "Done",
  "pipe.status.error": "Error",
  "pipe.status.skipped": "Not run",
  "pipe.plan.short": "Threats",
  "pipe.plan.phase": "Phase 1 · Plan",
  "pipe.plan.desc":
    "Models threats and derives security requirements from the system context.",
  "pipe.skills.short": "Skills",
  "pipe.skills.phase": "Phase 2 · Code",
  "pipe.skills.desc":
    "Validates skills/prompts against prompt injection, exfiltration and policy bypass.",
  "pipe.software.short": "Software",
  "pipe.software.phase": "Phase 3 · Code",
  "pipe.software.desc":
    "Runs SAST + SCA over the repository and ranks findings by severity.",
  "pipe.refactor.short": "Fix",
  "pipe.refactor.phase": "Phase 4 · Refactor",
  "pipe.refactor.desc":
    "Code fix and Pull Request, generated on demand per finding.",

  "metric.threats": "threats",
  "metric.requirements": "requirements",
  "metric.skills": "skills",
  "metric.rejected": "rejected",
  "metric.sast": "SAST",
  "metric.ai": "AI",
  "metric.sca": "SCA",
  "metric.fixes": "fixes",
  "metric.prs": "PRs",

  "pr.tokenRequired": "Choose the GitHub token",
  "pr.tokenPrivateHint":
    "This repository is private, so the PR must be opened with a token of yours.",
  "pr.savedTokens": "Saved tokens",
  "pr.newToken": "+ Use a new token…",
  "pr.retryWithToken": "Open PR with this token",
  "pr.tokenScopeHint":
    "Needs write access. Public repositories use the server token automatically.",
  "pr.kicker": "Fixes shipped",
  "pr.subtitle": "Fix PRs you opened from your analyses.",
  "pr.empty":
    "You haven't opened any Pull Request yet. Generate fixes in an analysis and open a PR — it shows up here.",
  "pr.loadFailed": "Failed to load the Pull Requests.",
  "pr.colRepo": "Repository",
  "pr.colFiles": "Files",
  "pr.colOpened": "Opened",
  "pr.viewAnalysis": "Analysis",
  "pr.openOnGithub": "Open on GitHub",
  "pr.fixTitle": "Security fix: {title}",
  "pr.batchTitle": "StarGuard security fixes ({n})",
  "pr.batchIntro":
    "Security fixes generated by StarGuard ({findings} finding(s) across {files} file(s)).",
  "pr.changedFiles": "Changed files: {files}",
  "pr.reviewBeforeMerge": "Review every change before merging.",

  "export.label": "Export",
  "export.needScan": "Phase 3 (scan) hasn't produced findings to export yet.",
  "export.sarif": "SARIF 2.1.0",
  "export.sarifSub": "Uploads straight to GitHub Code Scanning",
  "export.csv": "CSV",
  "export.csvSub": "Spreadsheet (Excel, Sheets)",
  "export.json": "JSON",
  "export.jsonSub": "Raw data for pipelines",
  "csv.id": "id",
  "csv.source": "source",
  "csv.severity": "severity",
  "csv.rule": "rule",
  "csv.cwe": "cwe",
  "csv.owasp": "owasp",
  "csv.file": "file",
  "csv.line": "line",
  "csv.title": "title",
  "csv.description": "description",
  "csv.howToFix": "how_to_fix",
  "export.depUpgradeTo": "Upgrade to {version}",
  "export.depNoFix": "No published fix",
  "export.depUpgradeHelp": "Upgrade {pkg} to {version} or later.",
  "export.depNoFixHelp": "No fixed version has been published for {pkg}.",
  "list.delete": "Delete",
  "list.deleteOf": "Delete the analysis {name}",
  "list.deleteConfirm":
    "Delete the analysis “{name}”? It leaves your list; findings and the audit trail stay stored.",
  "list.deleteFailed": "Failed to delete the analysis.",
  "filter.all": "All",
  "filter.done": "Done",
  "filter.running": "Running",
  "filter.error": "Error",
  "filter.queued": "Queued",
  "filter.anyDate": "Any date",
  "filter.today": "Today",
  "filter.last7": "Last 7 days",
  "filter.last30": "Last 30 days",
  "filter.period": "Period",
  "filter.from": "From",
  "filter.to": "To",
  "filter.since": "since {date}",
  "filter.until": "until {date}",
  "filter.search": "Search…",
  "filter.clearSearch": "Clear search",
  "filter.allUsers": "All users",
  "filter.filterUsers": "Filter users…",
  "filter.noUsers": "No users.",

  "batch.title": "Batch fix",
  "batch.whatHappens": "What will happen",
  "batch.plan": "{findings} finding(s) across {files} file(s) ⇒ {calls} AI call(s).",
  "batch.grouped":
    "Findings in the same file are fixed together, in a single call.",
  "batch.costHint":
    "Each call consumes tokens from the configured provider. With the agent engine, each one also clones the repository — which takes a few minutes per file.",
  "batch.start": "Generate {n} fix(es)",
  "batch.generating": "Generating fixes… {done}/{total}",
  "batch.summary": "{done} ready of {total}",
  "batch.cancel": "Cancel generation",
  "batch.cancelHint": "Whatever is already done stays saved.",
  "batch.confirmClose":
    "Fixes are still being generated. Closing now cancels what is left. Continue?",
  "batch.statusQueued": "Queued",
  "batch.statusRunning": "Generating…",
  "batch.statusDone": "Ready",
  "batch.statusError": "Error",
  "batch.statusCancelled": "Cancelled",
  "batch.groupedWith":
    "Fixed together with {n} other finding(s) in this same file, in a single change.",
  "batch.noChangeItem":
    "The AI proposed no change to this file — it stays out of the PR.",
  "batch.noChangeCount":
    "{n} file(s) with no change proposed by the AI — not included in the PR.",
  "batch.openPr": "Open 1 PR with {n} file(s)",
  "batch.waiting": "Waiting for the fixes…",
  "batch.prOpened": "PR #{number} opened with {files} file(s).",
  "batch.nFindings": "{n} finding(s)",
  "batch.nFiles": "{n} file(s)",
  "batch.genFailed": "Failed to generate.",
  "batch.prFailed": "Failed to open the PR.",

  "help.overview": "Overview",
  "help.overviewText":
    "A summary of what the analysis found. Start with the code fixes — that is where you solve the problems and open a PR.",
  "help.fixes": "Security fixes",
  "help.fixesText":
    "Combines scanner findings (SAST) with the AI review (business rules, IDOR/authorization, multi-file logic). AI findings that would repeat a SAST one are dropped. Select what you want to solve and generate fixes with AI — each one can become a Pull Request.",
  "help.batch": "Batch fix",
  "help.batchText":
    "Select the findings and generate the fixes at once. At the end you open a single Pull Request with all of them. Or use “Fix with AI” on each card for a single one.",
  "help.deps": "Dependencies (SCA)",
  "help.depsText":
    "Packages with a known CVE detected by software composition analysis. The fix is upgrading to the indicated fixed version.",
  "help.threats": "Threats and requirements",
  "help.threatsText":
    "What the AI understood from the context you described: plausible threats (STRIDE, GDPR/LGPD, OWASP) and the technical requirements that mitigate them. This list holds no problems from your code — it is the contract Phase 3 checks the repository against. Violated rules show up under Fixes, tagged with the requirement id (R-01, R-02…); the ones that could not be verified in the code are listed at the bottom of that same tab. Worth reading: generic requirements are a sign the system context needs more detail.",
  "help.skills": "Skill validation",
  "help.skillsText":
    "Each skill/prompt is checked against prompt injection, data exfiltration and policy bypass. The verdict tells whether it is safe to use.",
  "help.batchModal": "How it works",
  "help.batchModalText":
    "Findings are grouped by file: each file gets ONE fix that solves all of its problems at once — so one fix never overwrites another. At the end you open a single Pull Request with every file.",
  "help.customizeFix": "Customize the fix",
  "help.customizeFixText":
    "Guide the AI: which library to use, keep a function signature, follow a project pattern, and so on. The AI receives the whole file plus the error context and fixes only the security problem, without changing business logic.",
  "fix.instructionsPlaceholder":
    "e.g. use parameterized queries from the pg driver, keep the function signature and the file style. Do not touch the other routes.",

  "results.done": "Analysis complete.",
  "results.inProgress": "Analysis in progress…",
  "results.sections": "Sections",
  "results.bySeverity": "Findings by severity",
  "results.ctaTitle": "{n} security fix(es) to apply",
  "results.ctaSub": "{n} critical. Generate fixes with AI and open a Pull Request.",
  "results.goToFixes": "Go to fixes",
  "results.rowFixes": "Security fixes",
  "results.rowDeps": "Dependencies (SCA)",
  "results.rowRequirements": "Requirements",
  "results.rowSkills": "Skills",
  "results.nFixes": "{n} fix(es)",
  "results.nCves": "{n} with CVE",
  "results.nThreats": "{threats} threats · {reqs} requirements",
  "results.nSkills": "{n} validated",
  "results.selectItems": "Select the items and apply fixes with AI.",
  "results.includesAi": "Includes {n} finding(s) from the AI review.",
  "results.waitingPrevious": "Waiting for the previous phases…",
  "results.phaseFailed": "This phase failed.",
  "results.newAnalysisLink": "← New analysis",

  "deps.title": "Dependencies · SCA",
  "deps.subtitle": "Vulnerable packages and the version that fixes them.",
  "deps.scanning": "Scanning dependencies…",
  "deps.empty": "No vulnerable dependencies found. 🎉",
  "deps.notRun": "SCA ({engine}) did not run.",
  "deps.notRunHint": "Dependencies were not checked.",

  "threats.modeling": "Modeling the threats…",
  "threats.requirements": "Technical security requirements",
  "unverified.title": "Declared rules that could not be verified",

  "skills.subtitle": "Security of the submitted skills/prompts.",
  "skills.validating": "Validating the skills…",
  "skills.empty": "No skills submitted for validation.",
  "skills.verdictApproved": "Approved",
  "skills.verdictReview": "Needs review",
  "skills.verdictRejected": "Rejected",

  "fixes.noScannerTitle": "No code analyzer ran.",
  "card.businessRule": "Business rule",

  "job.orphan":
    "The analysis was interrupted before it started (the server restarted). Run it again — nothing was lost in the repository.",
  "job.stale":
    "The analysis showed no sign of life for too long and was terminated (the server likely restarted mid-run).",
  "job.phaseFailed": "This step failed.",
  "job.unexpected": "Unexpected failure in the analysis.",
  "scan.noRepo": "No repository provided.",
  "scan.sastOff": "SAST disabled by configuration (SAST_ENGINE=none).",
  "scan.scaOff": "SCA disabled by configuration (SCA_ENGINE=none).",
  "scan.sastNotRun": "SAST ({engine}) did not run.",

  "depExplain.title": "Vulnerable dependency: {pkg}",
  "depExplain.whatItIs":
    "The version in use ({version}) has a known vulnerability, tracked as {cve}.",
  "depExplain.whyItMatters":
    "Third-party code runs with the same privileges as yours. A vulnerability with a public CVE already has a known exploit, and automated scanners look for it.",
  "depExplain.howToFix":
    "Upgrade `{pkg}` to {version} or later. If it is a transitive dependency, force the resolution in the lockfile.",
  "depExplain.noFixedVersion":
    "No fixed version yet. Consider replacing the dependency, isolating its use, or tracking progress on {cve}.",

  "skillCheck.scope": "Declares a goal/scope",
  "skillCheck.noExfiltration": "No data exfiltration instructions",
  "skillCheck.noPolicyBypass": "No policy bypass attempt",
  "skillCheck.noCommandExec": "No external command execution",
  "skillFinding.heuristicDesc":
    'Suspicious pattern detected by heuristic: "{match}".',
  "skillFinding.promptInjection.title":
    "Policy override instruction (prompt injection)",
  "skillFinding.promptInjection.fix":
    "Remove instructions asking the model to ignore system rules; skills must not override policy.",
  "skillFinding.dataExfiltration.title": "Possible data/secret exfiltration",
  "skillFinding.dataExfiltration.fix":
    "Forbid reading secrets and making network calls inside skills; enforce an operation allowlist.",
  "skillFinding.backdoor.title": "Embedded code/command execution",
  "skillFinding.backdoor.fix":
    "Skills must not run commands or evaluate arbitrary code. Remove the snippet.",
  "skillFinding.policyBypass.title": "Policy bypass attempt",
  "skillFinding.policyBypass.fix":
    "Remove language that tries to disable the model's safeguards.",
  "skillFinding.aiTitle": "AI finding",
  "skillFinding.aiRecommendation": "Review the flagged snippet.",

  "err.unauthenticated": "Session expired. Please sign in again.",
  "err.forbidden": "You do not have permission for this action.",
  "err.notFound": "Not found.",
  "err.conflict": "Conflict with an existing record.",
  "err.tooManyRequests": "Too many requests. Please wait a moment.",
  "err.server": "Server error. Please try again.",
  "err.githubTokenRequired":
    "Provide a GitHub token with write access to open the pull request.",
  "err.schemaOutdated":
    "The database is out of date with the application. Tell whoever administers it: migrations are missing.",
  "err.badRequest": "Invalid data.",
  "err.network": "No connection to the server.",
  "err.csrf": "Invalid CSRF token.",
  "err.emailTaken": "A user with this e-mail already exists.",
  "err.currentPasswordRequired":
    "Enter your current password to change the e-mail or the password.",
  "err.wrongCurrentPassword": "Current password is incorrect.",
  "err.cannotChangeOwnRole": "You cannot change your own role.",
  "err.cannotDeleteOwnAccount": "You cannot delete your own account.",
  "err.badExportFormat": "Invalid format. Use sarif, csv or json.",
  "err.threatModelFailed": "Failed to generate the threat model.",
  "err.skillsValidationFailed": "Failed to validate the skills.",

  "report.title": "Executive summary",
  "report.docTitle": "StarGuard — Security Report",
  "report.project": "Project",
  "report.back": "Back",
  "report.print": "Export / Print",
  "report.bySeverity": "Vulnerabilities by severity",
  "report.requirements": "Technical security requirements (Phase 1)",
  "report.skills": "Skill validation (Phase 2)",
  "report.skillRejected": "Rejected",
  "report.skillReview": "Review",
  "report.skillApproved": "Approved",
  "report.findingCount": "{n} finding(s)",
  "report.noSkills": "No skills validated in this analysis.",
  "report.findings": "Security findings (Phase 3)",
  "report.noFindings": "No code/dependency findings.",
  "report.fixedIn": "fixed in {v}",
  "report.aiReview": "AI review · business rules (Phase 3)",
  "report.noExtraFindings": "No findings beyond SAST/SCA.",
  "report.reviewNotRun": "AI review did not run.",
  "report.fixes": "Fixes applied (Phase 4)",
  "report.fixesOnDemand":
    "Fixes are generated on demand, finding by finding, on the results screen — none is generated automatically.",
  "report.footer": "Generated by StarGuard · Security Copilot",
  "report.metaAnalysis": "Analysis",
  "report.metaRunAt": "Run at",
  "report.metaPrintedAt": "Issued at",
  "report.metaEngines": "Engines",
  "report.loadFailed": "Failed to load the report.",

  "auditEvent.login.success": "Sign-in",
  "auditEvent.login.fail": "Failed sign-in",
  "auditEvent.login.ratelimited": "Sign-in blocked (rate limit)",
  "auditEvent.logout": "Sign-out",
  "auditEvent.token.refresh": "Session renewed",
  "auditEvent.session.revoked": "Sessions revoked",
  "auditEvent.analyze.start": "Analysis started",
  "auditEvent.finding.status": "Finding updated",
  "auditEvent.fix.generate": "Fix generated",
  "auditEvent.fix.cached": "Fix reused",
  "auditEvent.analyze.done": "Analysis completed",
  "auditEvent.analysis.delete": "Analysis deleted",
  "auditEvent.analysis.export": "Findings exported",
  "auditEvent.pr.open": "PR opened",
  "auditEvent.pr.batch": "Batch PR",
  "auditEvent.token.create": "Token created",
  "auditEvent.token.delete": "Token removed",
  "auditEvent.account.update": "Account updated",
  "auditEvent.user.create": "User created",
  "auditEvent.user.role.update": "Role changed",
  "auditEvent.user.delete": "User deleted",

  "monitoring.subtitle": "Audit trail of everything that happens on the platform.",
  "monitoring.searchPlaceholder": "Search by event or detail…",
  "monitoring.category": "Category",
  "monitoring.empty": "No records for the current filters.",
  "monitoring.colWhen": "When",
  "monitoring.colEvent": "Event",
  "monitoring.colDetail": "Detail",
  "monitoring.colOrigin": "Origin",
  "monitoring.loadFailed": "Failed to load the logs.",
  "auditCategory.auth": "Authentication",
  "auditCategory.analise": "Analyses",
  "auditCategory.pr": "Pull Requests",
  "auditCategory.conta": "Account",
  "auditCategory.usuario": "Users",
  "auditCategory.sistema": "System",
  "adminAnalyses.subtitle": "Every analysis from every user.",
  "adminAnalyses.empty": "No analyses found.",

  "adminUsers.subtitle": "All accounts — manage roles and access.",
  "adminUsers.searchPlaceholder": "Search by name or e-mail…",
  "adminUsers.empty": "No users found.",
  "adminUsers.colUser": "User",
  "adminUsers.colPrs": "PRs",
  "adminUsers.colLastActivity": "Last activity",
  "adminUsers.you": "you",
  "adminUsers.deleteUser": "Delete user",
  "adminUsers.cannotDeleteSelf": "You can't delete yourself",
  "adminUsers.deleteConfirm":
    "Delete \"{name}\"? The account is deactivated (soft delete) and the person can no longer sign in. Their analyses stay in the history.",
  "adminUsers.loadFailed": "Failed to load the users.",
  "adminUsers.roleFailed": "Failed to change the role.",
  "adminUsers.deleteFailed": "Failed to delete the user.",

  "admin.dashTitle": "Global dashboard",
  "admin.dashSubtitle": "Consolidated view of every user, analysis and fix.",
  "admin.metricsFailed": "Failed to load metrics.",
  "admin.last7d": "in the last 7 days",
  "admin.running": "in progress",
  "admin.doneCount": "completed",
  "admin.errorCount": "with errors",
  "admin.sumOfAll": "Total across all analyses.",
  "admin.noFindings": "No findings recorded yet.",
  "admin.usersHint": "{n} account(s) — see per-user metrics",
  "admin.analysesHint": "{n} analysis(es) from all users",

  "account.kicker": "Settings",
  "account.subtitle": "Your sign-in details and GitHub tokens.",
  "account.basics": "Basic details",
  "account.name": "Name",
  "account.login": "Login (e-mail)",
  "account.loginHelp": "Change the login",
  "account.loginHelpText":
    "This e-mail is your login. To change it, confirm with your current password. Future sign-ins use the new e-mail.",
  "account.currentPasswordToConfirm": "Current password (to confirm the new login)",
  "account.currentPasswordPlaceholder": "your current password",
  "account.saveProfile": "Save details",
  "account.changePassword": "Change password",
  "account.currentPassword": "Current password",
  "account.newPassword": "New password",
  "account.confirmNewPassword": "Confirm new password",
  "account.min8": "at least 8 characters",
  "account.tokens": "GitHub tokens",
  "account.tokensHelp": "Encrypted tokens",
  "account.tokensHelpText":
    "Tokens are stored encrypted (AES-256-GCM) and never come back in plain text. We only show the name and the last 4 characters. You can keep several and choose which one to use when starting an analysis.",
  "account.tokensHint":
    "Stored encrypted; used to clone private repositories and open PRs.",
  "account.token": "Token",
  "account.tokenNamePlaceholder": "e.g. personal PAT",
  "account.tokenPlaceholder": "ghp_…",
  "account.save": "Save",
  "account.noTokens": "No tokens saved yet.",
  "account.createdAt": "Created",
  "account.lastUsed": "Last used",
  "account.remove": "Remove",
  "account.nothingToUpdate": "Nothing to update.",
  "account.needCurrentPassword":
    "Enter your current password to change the login (e-mail).",
  "account.profileUpdated": "Details updated.",
  "account.updateFailed": "Failed to update.",
  "account.enterCurrentPassword": "Enter your current password.",
  "account.newPasswordTooShort": "The new password needs at least 8 characters.",
  "account.confirmMismatch": "The confirmation doesn't match.",
  "account.passwordChanged": "Password changed successfully.",
  "account.changePasswordFailed": "Failed to change the password.",
  "account.tokenSaved": "Token saved securely (encrypted).",
  "account.saveTokenFailed": "Failed to save the token.",
  "account.removeTokenConfirm":
    "Remove this token? Future analyses will no longer be able to use it.",
  "account.removeTokenFailed": "Failed to remove the token.",
  "account.loadTokensFailed": "Failed to load the tokens.",
  "account.language": "Interface language",
  "account.languageHint":
    "Applies to the interface and to AI-generated text in future analyses.",

  // ---- Analyzers ----
  "analyzer.threat.name": "Threat modeling",
  "analyzer.threat.desc":
    "Reads the system description and raises threats and security requirements. Needs no code.",
  "analyzer.sast.name": "Code vulnerabilities",
  "analyzer.sast.desc": "Looks for insecure patterns in source code with Opengrep/Semgrep.",
  "analyzer.sca.name": "Vulnerable dependencies",
  "analyzer.sca.desc": "Looks for known CVEs in declared packages, with Trivy.",
  "analyzer.business.name": "Business rules",
  "analyzer.business.desc":
    "AI review of what scanners miss: violated business rules, IDOR and authorization.",
  "analyzer.skills.name": "Skills and prompts",
  "analyzer.skills.desc":
    "Analyzes skills for prompt injection, data exfiltration and backdoors.",

  "analyzer.reason.not_selected": "Not selected for this run.",
  "analyzer.reason.no_workspace": "Needs code: provide a repository or a directory.",
  "analyzer.reason.no_input": "The input this analyzer consumes was not provided.",
  "analyzer.reason.binary_missing": "The {bin} executable was not found on this machine.",
  "analyzer.reason.engine_off": "Turned off by configuration.",
  "analyzer.reason.no_ai_key": "Needs an AI key and none is configured.",

  "analyzer.degraded.threat":
    "Threat modeling was not part of this run: there were no declared requirements to check.",
  "analyzer.degraded.sast":
    "The code analyzer was not part of this run: findings were not deduplicated against it.",
  "analyzer.degraded.sca":
    "The dependency analyzer was not part of this run: findings were not deduplicated against it.",

  "fix.cannot.noFile": "The finding does not point to a file to fix.",
  "fix.cannot.noSnippet":
    "The finding carries neither a snippet nor a location — there is nothing that can be safely fixed.",
  "fix.cannot.noWorkspace": "No access to the code: provide the repository or open the project.",

  // ---- VS Code side tree ----
  "tree.state.unavailable": "unavailable",
  "tree.state.running": "analyzing…",
  "tree.state.clean": "nothing found",
  "tree.state.failed": "failed",
  "tree.findings.one": "1 finding",
  "tree.findings.many": "{n} findings",
  "tree.total.one": "1 finding in total",
  "tree.total.many": "{n} findings in total",
  "tree.signedInAs": "Signed in as {email}",
  "tree.action.describeSystem": "Describe the system…",
  "tree.action.installBinary": "How to install {bin}",
  "tree.action.openFolder": "Open a folder…",
  "tree.action.openSkill": "Open the skill file…",
  "tree.action.useAccountAi": "Use the AI from my account…",
  "tree.action.enable": "Enable in settings…",

  // ---- Analyzer selector (Screen 1) ----
  "select.title": "What to analyze",
  "select.hint":
    "Each analysis runs on its own. Pick only what you need now — the rest costs no time and no AI.",
  "select.all": "Select all",
  "select.none": "Clear selection",
  "select.chosen": "{n} of {total} selected",
  "select.unavailable": "Unavailable",
  "select.needsRepo": "Needs a repository",
  "select.fixes": "Fixes what it finds",
  "select.empty": "Pick at least one analyzer to start.",
  "select.loading": "Checking what is available…",
  "select.notRunHere": "Not run in this analysis.",

  // ---- Terminal app (packages/cli) ----
  "cli.clean": "clean",
  "cli.noFindings": "No findings. 🎉",
  "cli.col.severity": "SEV",
  "cli.col.location": "FILE",
  "cli.col.rule": "RULE",
  "cli.col.title": "ISSUE",
  "cli.failOnHit": "{n} finding(s) at {sev} or worse — exiting with code 1.",
  "cli.failOnClear": "Nothing at {sev} or worse.",
  "cli.sarifWritten": "SARIF written to {file}",
  "cli.list.title": "Available analyzers",
  "cli.doctor.analyzers": "Analyzers",

  "cli.doctor.aiRemote": "through your account ({server})",
  "cli.doctor.aiLocal": "local key",
  "cli.doctor.aiNone": "no local key and not signed in — run `starguard login`",

  // ---- Pre-commit hook ----
  "cli.hook.instalado": "Pre-commit hook installed.",
  "cli.hook.atualizado": "Pre-commit hook updated.",
  "cli.hook.removido": "Pre-commit hook removed.",
  "cli.hook.blockHint":
    "It WARNS and lets the commit through. To block: git config starguard.hookBlocks true",
  "cli.hook.notARepo": "This directory is not a git repository.",
  "cli.hook.foreign":
    "There is already a pre-commit hook from another tool at {path}. I will not overwrite it — call `starguard scan . --only sast,sca --no-ai` from inside it.",
  "cli.hook.notInstalled": "No StarGuard hook installed here.",

  // ---- Consent for account AI (code leaves the machine) ----
  "consent.title": "Use AI through your StarGuard account?",
  "consent.detail":
    "Snippets of the analyzed code will be sent to the StarGuard server and from there to the AI model. The server records who asked, which repository and the cost — NEVER the code, which is discarded after the analysis. If you prefer nothing to leave this machine, cancel and configure a local AI key.",
  "consent.accept": "Send and continue",

  "auth.required":
    "Sign in with your StarGuard account to use the extension. If you do not have one yet, run 'StarGuard: request access'.",
  "cli.fix.noTarget": "No fixable finding matches the given filters.",
  "cli.fix.noFixer": "this analyzer does not propose fixes.",
  "cli.fix.noChange": "the fix changed nothing — nothing to apply.",
  "cli.fix.dryRun": "dry run: use --write to save to disk.",
  "cli.fix.applied": "applied.",
  "cli.fix.total": "{n} fix(es) written.",
  "cli.help":
    "  starguard — security analysis in your terminal\n\n  USAGE\n    starguard scan [target]      target = directory (default: .) or GitHub URL\n    starguard skills <files>     validates skills, no repository needed\n    starguard fix [ids]          proposes a fix; with no id, fixes the worst one\n    starguard doctor             what is installed and configured\n    starguard list               the analyzers and what each one does\n\n  CHOOSE WHAT RUNS\n    --only sast,sca              only these analyzers\n    --skip business              all but these\n\n  OUTPUT\n    --json                       structured result (stable keys)\n    --sarif <file>               SARIF for GitHub Code Scanning\n    --fail-on critical|high|…    exit with code 1 on findings at this level\n    --lang pt-BR|en|es           output language\n\n  FIXING\n    --write                      save to disk (default is a dry run)\n    --all --severity high        fix everything from this severity up\n\n  OTHER\n    --no-ai                      use no model at all\n    --token <t>                  GitHub token (or GITHUB_TOKEN)\n    -d, --description <text>     system description (threats/business rules)\n\n  EXIT CODES\n    0  nothing above threshold  1  findings   2  execution failure",

  // ---- OAuth: consent and connected devices ----
  "oauth.client.vscode": "StarGuard for VS Code",
  "oauth.client.cli": "StarGuard in the terminal",
  "oauth.client.unknown": "Unknown application",
  "oauth.scope.analyze": "Analyze the code you open",
  "oauth.scope.fix": "Propose fixes and open Pull Requests",
  "oauth.scope.profile": "See your name and email",
  "oauth.title": "Connect {client}",
  "oauth.subtitle": "Signed in as {email}. If you authorize, this application will be able to:",
  "oauth.approve": "Authorize",
  "oauth.deny": "Cancel",
  "oauth.done": "Done. You can go back to {client}.",
  "oauth.manualTitle": "The editor did not open?",
  "oauth.manualHint": "Copy the code below and paste it into StarGuard, under «Paste the code».",
  "oauth.copy": "Copy",
  "oauth.copied": "Copied",

  "auth.waiting": "StarGuard: finish the authorization in the browser.",
  "auth.pasteCode": "Paste the code",
  "auth.pastePrompt": "Paste the code shown in the browser",
  "auth.pasteInvalid": "That does not look like the code from the browser.",
  "auth.cancelled": "Authorization cancelled.",
  "auth.readAccountFailed": "Could not read the account.",
  "auth.mismatch": "The response does not match this sign-in request.",
  "auth.timeout": "Timed out waiting for the authorization in the browser.",
  "auth.failed": "StarGuard: could not sign in. {erro}",
  "auth.connected": "StarGuard: signed in as {email}.",
  "auth.signedOut":
    "StarGuard: signed out of this editor. To end the session on the server, revoke the device under Account.",

  "oauth.opening": "Authorized. Opening {client}…",
  "oauth.openApp": "Open {client}",
  "oauth.openHint":
    "If nothing happens in a few seconds, click the button above: a browser only opens an application after a click of yours. It will ask for confirmation, and so will the editor.",
  "oauth.openExpires": "This link is valid for 2 minutes.",
  "oauth.denied": "Authorization cancelled. Nothing was connected.",
  "oauth.failed": "The authorization could not be completed.",
  "oauth.invalidRequest":
    "Invalid authorization request. It did not come from a recognized application — do not authorize.",
  "oauth.warning":
    "Only authorize if YOU just started this connection from the application.",
  "oauth.devices": "Connected devices",
  "oauth.devicesHint":
    "Applications with access to your account. Revoke anything you do not recognize — access stops immediately.",
  "oauth.devicesEmpty": "No connected devices.",
  "oauth.lastUsed": "Last used: {when}",
  "oauth.connectedAt": "Connected on {when}",
  "oauth.revokeDevice": "Revoke",
  "oauth.revokeConfirm": "Revoke this device's access? It will have to sign in again.",
  "oauth.revoked": "Access revoked.",
  "oauth.revokeFailed": "The access could not be revoked.",
  "err.oauthClient": "Application not recognized.",
  "err.oauthRedirect": "Return destination not allowed for this application.",
  "err.oauthPkce": "This application uses a security method we do not accept.",

  // ---- Terminal authentication ----
  "cli.login.opening": "Opening your browser to sign in…",
  "cli.login.orOpen": "If it does not open, go to:",
  "cli.login.done": "Signed in as {email}.",
  "cli.logout.done": "Credential removed from this computer.",
  "cli.logout.hint":
    "The server session stays active until it expires. If you suspect a leak, revoke it under Account → Connected devices.",
  "cli.whoami.anonymous": "Not signed in. Run `starguard login`.",
  "cli.whoami.expired":
    "Session ended (revoked, password changed, or credential reused). Run `starguard login`.",
  "cli.whoami.as": "Signed in as {email}.",
};

const ES: Record<MessageKey, string> = {
  "nav.newAnalysis": "Nuevo análisis",
  "nav.analyses": "Análisis",
  "nav.pullRequests": "Pull Requests",
  "nav.account": "Cuenta",
  "nav.governance": "Gobernanza",
  "nav.dashboard": "Panel",
  "nav.users": "Usuarios",
  "nav.globalAnalyses": "Análisis globales",
  "nav.monitoring": "Monitoreo",
  "nav.lightMode": "Modo claro",
  "nav.darkMode": "Modo oscuro",
  "nav.logout": "Salir",
  "nav.menu": "Menú",
  "nav.close": "Cerrar",
  "nav.activeAccount": "cuenta activa",
  "role.superadmin": "Superadmin",
  "role.admin": "Admin",
  "role.change": "Cambiar rol",
  "role.cannotChangeSelf": "No puedes cambiar tu propio rol",

  "meta.title": "StarGuard | Copiloto de Seguridad",
  "meta.description":
    "Plataforma de seguridad asistida por IA para el desarrollo seguro de software — DevSecOps de punta a punta, headless y AI-native.",

  "common.retry": "Intentar de nuevo",
  "common.refresh": "Actualizar",
  "common.cancel": "Cancelar",
  "common.details": "Ver detalles",
  "common.close": "Cerrar",
  "common.open": "Abrir",
  "common.report": "Informe",
  "common.new": "Nuevo",
  "common.loading": "Cargando…",
  "common.language": "Idioma",
  "common.moreInfo": "Más información",
  "common.total": "{n} en total",
  "common.previousPage": "Página anterior",
  "common.nextPage": "Página siguiente",

  "login.subtitle": "Copiloto de Seguridad · DevSecOps asistido por IA",
  "login.email": "Correo electrónico",
  "login.password": "Contraseña",
  "login.submit": "Entrar",
  "login.hint":
    "Acceso restringido. Usa las credenciales proporcionadas por el administrador.",
  "login.failed": "No se pudo iniciar sesión.",

  "severity.critical": "Crítica",
  "severity.high": "Alta",
  "severity.medium": "Media",
  "severity.low": "Baja",
  "severity.info": "Info",

  "status.open": "Abierto",
  "status.fixed": "Corregido",
  "status.pr_open": "PR abierto",
  "status.pr_merged": "PR fusionado",
  "status.false_positive": "Falso positivo",
  "status.accepted_risk": "Riesgo aceptado",
  "status.inherited": "heredado",

  "phase.running": "ejecutando…",
  "phase.pending": "en espera",
  "phase.error": "error",
  "phase.done": "completado",
  "phase.skipped": "no ejecutado",

  "results.kicker": "Análisis",
  "results.doneSubtitle": "Análisis completado. Empieza por las correcciones de código.",
  "results.runningSubtitle": "Ejecutando las 4 fases en tiempo real…",
  "results.degraded":
    "Conexión inestable — el seguimiento sigue reintentando por su cuenta.",
  "results.refreshNow": "Actualizar ahora",
  "results.phasesFailed": "{n} fase(s) fallaron:",
  "results.goToPhase": "Ver detalles",
  "results.loadFailed": "No se pudo cargar el análisis.",
  "results.progressLabel": "progreso",
  "tab.overview": "Vista general",
  "tab.fixes": "Correcciones",
  "tab.deps": "Dependencias",
  "tab.requirements": "Requisitos",
  "tab.skills": "Skills",
  "tab.ariaLabel": "Secciones del análisis",

  "fixes.searchPlaceholder": "Buscar por archivo, regla o CWE…",
  "fixes.allSeverities": "Toda severidad",
  "fixes.allSources": "Todo origen",
  "fixes.sourceSast": "SAST",
  "fixes.sourceAi": "Revisión IA",
  "fixes.filterOpen": "Abiertos ({n})",
  "fixes.filterResolved": "Resueltos ({n})",
  "fixes.filterAll": "Todos",
  "deps.installed": "instalada",
  "deps.fixedIn": "corregida en",
  "deps.manifestHint": "Archivo que edita la corrección",
  "deps.fixWithAi": "Corregir con IA",
  "deps.noFixedVersion":
    "Todavía no hay una versión corregida publicada para este paquete — no hay nada que proponer sin inventarlo.",
  "deps.noManifest":
    "No se pudo identificar el archivo donde se declara la dependencia.",
  "deps.selectPage": "Seleccionar las {n} de esta página",
  "deps.selectAllFiltered": "Seleccionar todas las {n}",
  "deps.fixSelected": "Corregir {n} con IA",
  "deps.lockWarningWithCmd":
    "La corrección modifica {manifest}; el archivo de lock ({lockfile}) NO se regenera automáticamente — ejecuta `{cmd}` e incluye el lock en el commit antes de fusionar.",
  "deps.lockWarning":
    "La corrección modifica {manifest}; el archivo de lock ({lockfile}) NO se regenera automáticamente — regenéralo con el gestor de paquetes del proyecto antes de fusionar.",
  "fixes.selectPage": "Seleccionar las {n} de esta página",
  "fixes.selectAllFiltered": "Seleccionar todas las {n}",
  "fixes.clearAll": "Limpiar selección",
  "fixes.selectedCount": "{n} de {total} seleccionadas",
  "fixes.fixWithAi": "Corregir {n} con IA",
  "fixes.showMore": "Mostrar {n} más de {total} restantes",
  "fixes.emptyFilters": "Ningún hallazgo para los filtros actuales.",
  "fixes.emptyResolved": "Todos los hallazgos de este análisis ya se resolvieron. 🎉",
  "fixes.emptyNoResolved": "Aún no hay hallazgos resueltos.",
  "fixes.empty": "No se encontró ninguna corrección de seguridad. 🎉",
  "fixes.analyzing": "Analizando el código fuente…",
  "fixes.noScanner":
    "Ningún analizador de código se ejecutó. {reasons} Esto no significa que el repositorio esté limpio — significa que no fue analizado.",
  "fixes.coverage":
    "La revisión por IA leyó {reviewed} de {eligible} archivos elegibles (priorizando autenticación, rutas, base de datos y los archivos que SAST señaló). SAST y SCA analizaron el repositorio completo.",
  "fixes.coverageTruncated": "{n} archivo(s) se truncaron por tamaño.",

  "card.line": "línea {n}",
  "card.technicalDetails": "Detalles técnicos",
  "card.technicalHint": "Fragmento de código y texto original de la herramienta",
  "card.technicalHintWithAttack":
    "Ruta de ataque, fragmento de código y texto original de la herramienta",
  "card.attackScenario": "Cómo se explotaría",
  "card.originalText": "Texto original de la herramienta",
  "card.howToFix": "Cómo corregir",
  "card.suggestion": "Sugerencia de corrección",
  "card.recommendation": "Recomendación",
  "card.aiGenerated":
    "Texto generado por IA a partir del repositorio analizado — verifícalo antes de tratarlo como veredicto de la herramienta.",
  "card.confidenceMedium": "confianza media",
  "card.confidenceMediumHint":
    "La revisión por IA no tuvo certeza sobre este hallazgo. Verifícalo antes de actuar.",
  "card.openOnGitHubHint":
    "Abrir en GitHub (código actual del repositorio — puede haber cambiado desde el análisis)",
  "filter.confidence": "Confianza",
  "filter.confidenceAll": "Toda",
  "filter.confidenceHigh": "Solo alta",
  "filter.severity": "Severidad",
  "filter.source": "Origen",
  "filter.byStatus": "Filtrar por estado",
  "card.fixWithAi": "Corregir con IA",
  "card.viewFix": "Ver corrección",
  "card.markFixed": "Ya lo corregí",
  "card.markFalsePositive": "Falso positivo",
  "card.reopen": "Reabrir",
  "card.selectToFix": 'Seleccionar "{title}" para corregir',

  "fix.title": "Corregir con IA",
  "fix.apply": "Aplicar la corrección",
  "fix.applied": "Corrección aplicada.",
  "fix.problem": "El problema",
  "fix.instructions": "Instrucciones para la IA (opcional)",
  "fix.generate": "Generar corrección",
  "fix.regenerate": "Rehacer con estas instrucciones",
  "fix.regenerateHint":
    "Rehacer consume una nueva llamada de IA — la corrección actual ya está guardada.",
  "fix.confirmDiscard":
    "Escribiste instrucciones y todavía no generaste la corrección. Cerrar ahora descarta lo que escribiste. ¿Cerrar de todos modos?",
  "fix.generating": "Generando corrección con IA…",
  "fix.whatChanged": "Qué cambió y por qué",
  "fix.changesIn": "Cambios en {file}",
  "fix.noChange":
    "La IA no propuso ningún cambio en el código. Ajusta las instrucciones y rehaz, o trata este hallazgo manualmente. No se puede abrir un PR sin cambios.",
  "fix.openPr": "Abrir PR en GitHub",
  "fix.needRepo": "Indica la URL del repositorio en la Pantalla 1 para abrir un PR.",
  "fix.prOpened": "PR #{number} abierto ({branch}).",
  "fix.viewOnGithub": "Ver en GitHub",
  "fix.multiFile":
    "El agente modificó {n} archivos — todos entran en el mismo PR: {files}",
  "fix.wholeFile":
    "La IA recibió el archivo completo; el PR guarda el contenido íntegro.",
  "fix.snippetOnly":
    "La IA solo recibió el fragmento — no se pudo obtener el archivo completo.",
  "fix.failed": "No se pudo generar la corrección.",
  "fix.guide":
    "Corrige solo este problema de seguridad, sin cambiar la lógica de negocio, manteniendo el estilo y la indentación del archivo.",
  "fix.genericSuggestion": "Revisa el fragmento según la recomendación.",

  "diff.showAll": "Mostrar todo",
  "diff.onlyChanges": "Solo lo que cambió",
  "diff.fullFile": "Archivo completo",
  "diff.viewDiff": "Ver diff",
  "diff.noChange": "ningún cambio",
  "diff.unchangedLines": "{n} líneas sin cambios",

  "onb.kicker": "Nuevo análisis",
  "onb.title": "Vamos a analizar tu proyecto",
  "onb.subtitle":
    "Describe el sistema y pulsa iniciar — StarGuard se encarga de las 4 fases.",
  "onb.phases": "Las 4 fases",
  "onb.projectName": "Nombre del proyecto",
  "onb.projectPlaceholder": "Ej.: Portal del Paciente",
  "onb.optional": "Repositorio y skills",
  "onb.optionalHint": "Opcional — conecta GitHub y envía skills para validar",
  "onb.submit": "Iniciar análisis",
  "onb.failed": "No se pudo iniciar el análisis.",
  "phase1.label": "Amenazas",
  "phase1.desc":
    "Fase 1 · Modela amenazas y requisitos de seguridad a partir de tu contexto.",
  "phase2.label": "Skills",
  "phase2.desc": "Fase 2 · Valida skills/prompts contra inyección y exfiltración.",
  "phase3.label": "Software",
  "phase3.desc":
    "Fase 3 · SAST + SCA sobre el repositorio, priorizados por severidad.",
  "phase4.label": "Corrección",
  "phase4.desc": "Fase 4 · Genera la corrección y abre el Pull Request en GitHub.",

  "threatInput.label": "Contexto del sistema",
  "threatInput.help": "Qué describir aquí",
  "threatInput.helpText":
    "Pega la descripción del sistema, notas de reunión o requisitos de cumplimiento. Este texto se convierte en contexto para las 4 fases: amenazas, validación de skills, escaneo y corrección. Ej.: datos sensibles, flujos de inicio de sesión, integraciones de pago y reglas de negocio.",
  "threatInput.placeholder":
    "Ej.: API de telemedicina que almacena datos de salud (RGPD/LGPD). Inicio de sesión por correo y contraseña, historias clínicas por paciente, pago con tarjeta (PCI). Un médico solo accede a pacientes de su clínica…",

  "repo.label": "Repositorio de GitHub",
  "repo.help": "URL del repositorio",
  "repo.helpText":
    "Solo se acepta github.com (lista blanca anti-SSRF). Sin repositorio, la Fase 3 (escaneo de código) no se ejecuta — las demás fases siguen con normalidad.",
  "repo.placeholder": "https://github.com/starbridge/mi-proyecto",
  "repo.invalid":
    "URL no válida. Usa el formato https://github.com/propietario/repositorio — solo se acepta github.com.",
  "repo.tokenLabel": "Token de acceso",
  "repo.tokenHelp": "Personal Access Token",
  "repo.tokenHelpText":
    "Necesario solo para repositorios privados. El token vive únicamente en memoria durante el trabajo y nunca se persiste ni se devuelve al cliente.",
  "repo.tokenPlaceholder": "ghp_… (opcional)",

  "tokenPicker.help": "Token de GitHub",
  "tokenPicker.helpText":
    "Necesario solo para repositorios privados / abrir un PR. Elige un token guardado (cifrado en tu cuenta) o escribe uno nuevo. Un token nuevo puede guardarse en la cuenta para reutilizarlo — siempre cifrado, nunca en texto plano.",
  "tokenPicker.none": "Ninguno (repositorio público)",
  "tokenPicker.new": "+ Nuevo token…",
  "tokenPicker.saveToAccount": "Guardar en la cuenta (cifrado)",
  "tokenPicker.namePlaceholder": "Nombre del token (ej.: PAT personal)",

  "skillInput.label": "Skills a validar",
  "skillInput.help": "Validación de skills",
  "skillInput.helpText":
    "Envía SKILL.md, prompts o plantillas para que la Fase 2 verifique prompt injection, exfiltración de datos y evasión de política. Opcional.",
  "skillInput.namePlaceholder": "nombre-de-la-skill.md",
  "skillInput.contentPlaceholder":
    "Pega el contenido de la skill/prompt (SKILL.md, plantilla…)",
  "skillInput.remove": "Quitar skill",
  "skillInput.add": "+ Añadir skill",
  "skillInput.upload": "Subir archivos",

  "list.historyKicker": "Historial",
  "list.analysesTitle": "Análisis",
  "list.analysesSubtitle":
    "Tus análisis de seguridad, del más reciente al más antiguo.",
  "list.searchAnalyses": "Buscar por proyecto o repositorio…",
  "list.colProject": "Proyecto",
  "list.colSeverities": "Severidades",
  "list.colFindings": "Hallazgos",
  "list.colStatus": "Estado",
  "list.colCreated": "Creado",
  "list.empty": "Todavía no hay análisis.",
  "list.startFirst": "Inicia el primero",
  "list.loadFailed": "No se pudieron cargar los análisis.",
  "list.prs": "{n} PR(s)",
  "list.openRepo": "Abrir repositorio",

  "newUser.title": "Nuevo usuario",
  "newUser.subtitle": "Define el acceso y el rol de la nueva cuenta.",
  "newUser.help": "Crear usuario",
  "newUser.helpText":
    "El usuario entra con el correo y la contraseña definidos aquí. El superadmin lo ve todo de todos; el admin solo ve su propio historial. La contraseña se guarda con hash Argon2id.",
  "newUser.name": "Nombre",
  "newUser.namePlaceholder": "Ej.: María Silva",
  "newUser.email": "Correo electrónico",
  "newUser.emailPlaceholder": "persona@empresa.com",
  "newUser.password": "Contraseña",
  "newUser.passwordPlaceholder": "mínimo 8 caracteres",
  "newUser.passwordTooShort": "La contraseña necesita al menos 8 caracteres.",
  "newUser.role": "Rol",
  "newUser.roleAdminSub": "Solo ve su propio historial",
  "newUser.roleSuperadminSub": "Lo ve todo de todos",
  "newUser.submit": "Crear usuario",
  "newUser.failed": "No se pudo crear el usuario.",
  "newUser.confirmDiscard":
    "Rellenaste el formulario y todavía no creaste el usuario. Cerrar ahora descarta lo que escribiste. ¿Cerrar de todos modos?",

  "pipe.ariaLabel": "Progreso de las 4 fases",
  "pipe.status.pending": "En espera",
  "pipe.status.running": "Ejecutando",
  "pipe.status.done": "Completado",
  "pipe.status.error": "Error",
  "pipe.status.skipped": "No ejecutado",
  "pipe.plan.short": "Amenazas",
  "pipe.plan.phase": "Fase 1 · Plan",
  "pipe.plan.desc":
    "Modela amenazas y deriva requisitos de seguridad a partir del contexto del sistema.",
  "pipe.skills.short": "Skills",
  "pipe.skills.phase": "Fase 2 · Code",
  "pipe.skills.desc":
    "Valida skills/prompts contra prompt injection, exfiltración y evasión de política.",
  "pipe.software.short": "Software",
  "pipe.software.phase": "Fase 3 · Code",
  "pipe.software.desc":
    "Ejecuta SAST + SCA sobre el repositorio y prioriza los hallazgos por severidad.",
  "pipe.refactor.short": "Corrección",
  "pipe.refactor.phase": "Fase 4 · Refactor",
  "pipe.refactor.desc":
    "Corrección del código y apertura del Pull Request, bajo demanda por hallazgo.",

  "metric.threats": "amenazas",
  "metric.requirements": "requisitos",
  "metric.skills": "skills",
  "metric.rejected": "rechazadas",
  "metric.sast": "SAST",
  "metric.ai": "IA",
  "metric.sca": "SCA",
  "metric.fixes": "correcciones",
  "metric.prs": "PRs",

  "pr.tokenRequired": "Elige el token de GitHub",
  "pr.tokenPrivateHint":
    "Este repositorio es privado, así que el PR debe abrirse con un token tuyo.",
  "pr.savedTokens": "Tokens guardados",
  "pr.newToken": "+ Usar un token nuevo…",
  "pr.retryWithToken": "Abrir PR con este token",
  "pr.tokenScopeHint":
    "Necesita permiso de escritura. Un repositorio público usa el token del servidor automáticamente.",
  "pr.kicker": "Correcciones enviadas",
  "pr.subtitle": "PRs de corrección que abriste a partir de los análisis.",
  "pr.empty":
    "Todavía no abriste ningún Pull Request. Genera correcciones en un análisis y abre un PR — aparecerá aquí.",
  "pr.loadFailed": "No se pudieron cargar los Pull Requests.",
  "pr.colRepo": "Repositorio",
  "pr.colFiles": "Archivos",
  "pr.colOpened": "Abierto",
  "pr.viewAnalysis": "Análisis",
  "pr.openOnGithub": "Abrir en GitHub",
  "pr.fixTitle": "Corrección de seguridad: {title}",
  "pr.batchTitle": "Correcciones de seguridad StarGuard ({n})",
  "pr.batchIntro":
    "Correcciones de seguridad generadas por StarGuard ({findings} hallazgo(s) en {files} archivo(s)).",
  "pr.changedFiles": "Archivos modificados: {files}",
  "pr.reviewBeforeMerge": "Revisa cada cambio antes de fusionar.",

  "export.label": "Exportar",
  "export.needScan": "La Fase 3 (escaneo) todavía no produjo hallazgos para exportar.",
  "export.sarif": "SARIF 2.1.0",
  "export.sarifSub": "Se sube directo a GitHub Code Scanning",
  "export.csv": "CSV",
  "export.csvSub": "Hoja de cálculo (Excel, Sheets)",
  "export.json": "JSON",
  "export.jsonSub": "Datos crudos para pipelines",
  "csv.id": "id",
  "csv.source": "origen",
  "csv.severity": "severidad",
  "csv.rule": "regla",
  "csv.cwe": "cwe",
  "csv.owasp": "owasp",
  "csv.file": "archivo",
  "csv.line": "linea",
  "csv.title": "titulo",
  "csv.description": "descripcion",
  "csv.howToFix": "como_corregir",
  "export.depUpgradeTo": "Actualizar a {version}",
  "export.depNoFix": "Sin corrección publicada",
  "export.depUpgradeHelp": "Actualiza {pkg} a {version} o superior.",
  "export.depNoFixHelp": "No hay versión corregida publicada para {pkg}.",
  "list.delete": "Eliminar",
  "list.deleteOf": "Eliminar el análisis {name}",
  "list.deleteConfirm":
    "¿Eliminar el análisis “{name}”? Sale de tu lista; los hallazgos y la traza de auditoría se conservan.",
  "list.deleteFailed": "No se pudo eliminar el análisis.",
  "filter.all": "Todos",
  "filter.done": "Completados",
  "filter.running": "En ejecución",
  "filter.error": "Error",
  "filter.queued": "En cola",
  "filter.anyDate": "Cualquier fecha",
  "filter.today": "Hoy",
  "filter.last7": "Últimos 7 días",
  "filter.last30": "Últimos 30 días",
  "filter.period": "Periodo",
  "filter.from": "Desde",
  "filter.to": "Hasta",
  "filter.since": "desde {date}",
  "filter.until": "hasta {date}",
  "filter.search": "Buscar…",
  "filter.clearSearch": "Limpiar búsqueda",
  "filter.allUsers": "Todos los usuarios",
  "filter.filterUsers": "Filtrar usuarios…",
  "filter.noUsers": "Ningún usuario.",

  "batch.title": "Corregir en lote",
  "batch.whatHappens": "Qué va a pasar",
  "batch.plan":
    "{findings} hallazgo(s) en {files} archivo(s) ⇒ {calls} llamada(s) de IA.",
  "batch.grouped":
    "Los hallazgos del mismo archivo se corrigen juntos, en una sola llamada.",
  "batch.costHint":
    "Cada llamada consume tokens del proveedor configurado. Con el motor de agente, cada una también clona el repositorio — lo que lleva algunos minutos por archivo.",
  "batch.start": "Generar {n} corrección(es)",
  "batch.generating": "Generando correcciones… {done}/{total}",
  "batch.summary": "{done} lista(s) de {total}",
  "batch.cancel": "Cancelar generación",
  "batch.cancelHint": "Lo que ya está listo permanece guardado.",
  "batch.confirmClose":
    "Las correcciones todavía se están generando. Cerrar ahora cancela lo que falta. ¿Continuar?",
  "batch.statusQueued": "En cola",
  "batch.statusRunning": "Generando…",
  "batch.statusDone": "Lista",
  "batch.statusError": "Error",
  "batch.statusCancelled": "Cancelada",
  "batch.groupedWith":
    "Corregida junto a {n} hallazgo(s) más de este mismo archivo, en un único cambio.",
  "batch.noChangeItem":
    "La IA no propuso cambios en este archivo — queda fuera del PR.",
  "batch.noChangeCount":
    "{n} archivo(s) sin cambios propuestos por la IA — no entran en el PR.",
  "batch.openPr": "Abrir 1 PR con {n} archivo(s)",
  "batch.waiting": "Espera a que terminen las correcciones…",
  "batch.prOpened": "PR #{number} abierto con {files} archivo(s).",
  "batch.nFindings": "{n} hallazgo(s)",
  "batch.nFiles": "{n} archivo(s)",
  "batch.genFailed": "No se pudo generar.",
  "batch.prFailed": "No se pudo abrir el PR.",

  "help.overview": "Vista general",
  "help.overviewText":
    "Resumen de lo que encontró el análisis. Empieza por las correcciones de código — es donde resuelves los problemas y abres un PR.",
  "help.fixes": "Correcciones de seguridad",
  "help.fixesText":
    "Reúne las vulnerabilidades del escáner (SAST) y los hallazgos de la revisión por IA (regla de negocio, IDOR/autorización, lógica multiarchivo). Los hallazgos de la IA que repetirían uno de SAST se descartan. Selecciona lo que quieras resolver y genera correcciones con IA — cada una puede convertirse en un Pull Request.",
  "help.batch": "Corrección en lote",
  "help.batchText":
    "Selecciona los hallazgos y genera las correcciones de una vez. Al final abres un único Pull Request con todas. O usa “Corregir con IA” en cada tarjeta para una sola.",
  "help.deps": "Dependencias (SCA)",
  "help.depsText":
    "Paquetes con CVE conocido detectados por el análisis de composición de software. La corrección es actualizar a la versión corregida indicada.",
  "help.threats": "Amenazas y requisitos",
  "help.threatsText":
    "Lo que la IA entendió del contexto que describiste: amenazas plausibles (STRIDE, RGPD/LGPD, OWASP) y los requisitos técnicos que las mitigan. Esta lista no trae problemas de tu código — es el contrato con el que la Fase 3 comprueba el repositorio. Las reglas incumplidas aparecen en Correcciones, marcadas con el id del requisito (R-01, R-02…); las que no se pudieron verificar en el código quedan listadas al final de esa misma pestaña. Vale la pena leerla: unos requisitos genéricos indican que el contexto del sistema necesita más detalle.",
  "help.skills": "Validación de skills",
  "help.skillsText":
    "Cada skill/prompt se comprueba contra prompt injection, exfiltración de datos y evasión de política. El veredicto indica si es seguro usarla.",
  "help.batchModal": "Cómo funciona",
  "help.batchModalText":
    "Los hallazgos se agrupan por archivo: cada archivo recibe UNA corrección que resuelve todos sus problemas de una vez — así una corrección no sobrescribe a otra. Al final abres un único Pull Request con todos los archivos.",
  "help.customizeFix": "Personaliza la corrección",
  "help.customizeFixText":
    "Orienta a la IA: qué biblioteca usar, mantener la firma de una función, seguir un patrón del proyecto, etc. La IA recibe el archivo completo más el contexto del error y corrige solo el problema de seguridad, sin cambiar la lógica de negocio.",
  "fix.instructionsPlaceholder":
    "Ej.: usa consultas parametrizadas del driver pg, mantén la firma de la función y el estilo del archivo. No modifiques las demás rutas.",

  "results.done": "Análisis completado.",
  "results.inProgress": "Análisis en curso…",
  "results.sections": "Secciones",
  "results.bySeverity": "Hallazgos por severidad",
  "results.ctaTitle": "{n} corrección(es) de seguridad por aplicar",
  "results.ctaSub":
    "{n} crítica(s). Genera correcciones con IA y abre un Pull Request.",
  "results.goToFixes": "Ir a las correcciones",
  "results.rowFixes": "Correcciones de seguridad",
  "results.rowDeps": "Dependencias (SCA)",
  "results.rowRequirements": "Requisitos",
  "results.rowSkills": "Skills",
  "results.nFixes": "{n} corrección(es)",
  "results.nCves": "{n} con CVE",
  "results.nThreats": "{threats} amenazas · {reqs} requisitos",
  "results.nSkills": "{n} validada(s)",
  "results.selectItems": "Selecciona los elementos y aplica correcciones con IA.",
  "results.includesAi": "Incluye {n} hallazgo(s) de la revisión por IA.",
  "results.waitingPrevious": "Esperando a las fases anteriores…",
  "results.phaseFailed": "Esta fase falló.",
  "results.newAnalysisLink": "← Nuevo análisis",

  "deps.title": "Dependencias · SCA",
  "deps.subtitle": "Paquetes vulnerables y la versión que los corrige.",
  "deps.scanning": "Escaneando las dependencias…",
  "deps.empty": "No se encontraron dependencias vulnerables. 🎉",
  "deps.notRun": "El SCA ({engine}) no se ejecutó.",
  "deps.notRunHint": "Las dependencias no fueron verificadas.",

  "threats.modeling": "Modelando las amenazas…",
  "threats.requirements": "Requisitos técnicos de seguridad",
  "unverified.title": "Reglas declaradas que no se pudieron verificar",

  "skills.subtitle": "Seguridad de las skills/prompts enviados.",
  "skills.validating": "Validando las skills…",
  "skills.empty": "Ninguna skill enviada para validación.",
  "skills.verdictApproved": "Validada",
  "skills.verdictReview": "Requiere revisión",
  "skills.verdictRejected": "Rechazada",

  "fixes.noScannerTitle": "Ningún analizador de código se ejecutó.",
  "card.businessRule": "Regla de negocio",

  "job.orphan":
    "El análisis se interrumpió antes de empezar (el servidor se reinició). Ejecútalo de nuevo — no se perdió nada en el repositorio.",
  "job.stale":
    "El análisis no dio señales de vida durante demasiado tiempo y se dio por terminado (probable reinicio del servidor durante el procesamiento).",
  "job.phaseFailed": "Falla en la etapa.",
  "job.unexpected": "Falla inesperada en el análisis.",
  "scan.noRepo": "No se indicó ningún repositorio.",
  "scan.sastOff": "SAST desactivado por configuración (SAST_ENGINE=none).",
  "scan.scaOff": "SCA desactivado por configuración (SCA_ENGINE=none).",
  "scan.sastNotRun": "El SAST ({engine}) no se ejecutó.",

  "depExplain.title": "Dependencia vulnerable: {pkg}",
  "depExplain.whatItIs":
    "La versión en uso ({version}) tiene una vulnerabilidad conocida, registrada como {cve}.",
  "depExplain.whyItMatters":
    "El código de terceros se ejecuta con los mismos privilegios que el tuyo. Una vulnerabilidad con CVE público ya tiene un exploit conocido y los escáneres automáticos la buscan.",
  "depExplain.howToFix":
    "Actualiza `{pkg}` a {version} o superior. Si es una dependencia transitiva, fuerza la resolución en el lockfile.",
  "depExplain.noFixedVersion":
    "Todavía no hay versión corregida. Evalúa reemplazar la dependencia, aislar su uso o seguir el avance de {cve}.",

  "skillCheck.scope": "Declara un objetivo/alcance",
  "skillCheck.noExfiltration": "Sin instrucciones de exfiltración de datos",
  "skillCheck.noPolicyBypass": "Sin intento de evasión de política",
  "skillCheck.noCommandExec": "Sin ejecución de comandos externos",
  "skillFinding.heuristicDesc":
    'Patrón sospechoso detectado por heurística: "{match}".',
  "skillFinding.promptInjection.title":
    "Instrucción de anulación de política (prompt injection)",
  "skillFinding.promptInjection.fix":
    "Elimina las instrucciones que piden al modelo ignorar las reglas del sistema; las skills no deben anular la política.",
  "skillFinding.dataExfiltration.title": "Posible exfiltración de datos/secretos",
  "skillFinding.dataExfiltration.fix":
    "Prohíbe la lectura de secretos y las llamadas de red dentro de las skills; aplica una lista blanca de operaciones.",
  "skillFinding.backdoor.title": "Ejecución de código/comandos incrustada",
  "skillFinding.backdoor.fix":
    "Las skills no deben ejecutar comandos ni evaluar código arbitrario. Elimina el fragmento.",
  "skillFinding.policyBypass.title": "Intento de evasión de política",
  "skillFinding.policyBypass.fix":
    "Elimina el lenguaje que intenta desactivar las salvaguardas del modelo.",
  "skillFinding.aiTitle": "Hallazgo de la IA",
  "skillFinding.aiRecommendation": "Revisa el fragmento señalado.",

  "err.unauthenticated": "Sesión expirada. Vuelve a iniciar sesión.",
  "err.forbidden": "No tienes permiso para esta acción.",
  "err.notFound": "No encontrado.",
  "err.conflict": "Conflicto con un registro existente.",
  "err.tooManyRequests": "Demasiadas solicitudes. Espera unos instantes.",
  "err.server": "Error en el servidor. Inténtalo de nuevo.",
  "err.githubTokenRequired":
    "Indica un token de GitHub con permiso de escritura para abrir el pull request.",
  "err.schemaOutdated":
    "La base de datos está desactualizada respecto a la aplicación. Avisa a quien la administra: faltan migraciones.",
  "err.badRequest": "Datos no válidos.",
  "err.network": "Sin conexión con el servidor.",
  "err.csrf": "Token CSRF no válido.",
  "err.emailTaken": "Ya existe un usuario con este correo.",
  "err.currentPasswordRequired":
    "Indica la contraseña actual para cambiar el correo o la contraseña.",
  "err.wrongCurrentPassword": "La contraseña actual es incorrecta.",
  "err.cannotChangeOwnRole": "No se puede cambiar el propio rol.",
  "err.cannotDeleteOwnAccount": "No se puede eliminar la propia cuenta.",
  "err.badExportFormat": "Formato no válido. Usa sarif, csv o json.",
  "err.threatModelFailed": "No se pudo generar el modelado de amenazas.",
  "err.skillsValidationFailed": "No se pudieron validar las skills.",

  "report.title": "Resumen ejecutivo",
  "report.docTitle": "StarGuard — Informe de Seguridad",
  "report.project": "Proyecto",
  "report.back": "Volver",
  "report.print": "Exportar / Imprimir",
  "report.bySeverity": "Vulnerabilidades por severidad",
  "report.requirements": "Requisitos técnicos de seguridad (Fase 1)",
  "report.skills": "Validación de skills (Fase 2)",
  "report.skillRejected": "Rechazada",
  "report.skillReview": "Revisar",
  "report.skillApproved": "Validada",
  "report.findingCount": "{n} hallazgo(s)",
  "report.noSkills": "Ninguna skill validada en este análisis.",
  "report.findings": "Hallazgos de seguridad (Fase 3)",
  "report.noFindings": "Sin hallazgos de código/dependencias.",
  "report.fixedIn": "corrige en {v}",
  "report.aiReview": "Revisión por IA · reglas de negocio (Fase 3)",
  "report.noExtraFindings": "Sin hallazgos adicionales más allá de SAST/SCA.",
  "report.reviewNotRun": "La revisión por IA no se ejecutó.",
  "report.fixes": "Correcciones aplicadas (Fase 4)",
  "report.fixesOnDemand":
    "Las correcciones se generan bajo demanda, hallazgo a hallazgo, en la pantalla de resultados — ninguna se genera automáticamente.",
  "report.footer": "Generado por StarGuard · Copiloto de Seguridad",
  "report.metaAnalysis": "Análisis",
  "report.metaRunAt": "Ejecutado el",
  "report.metaPrintedAt": "Emitido el",
  "report.metaEngines": "Motores",
  "report.loadFailed": "No se pudo cargar el informe.",

  "auditEvent.login.success": "Inicio de sesión",
  "auditEvent.login.fail": "Inicio de sesión fallido",
  "auditEvent.login.ratelimited": "Inicio de sesión bloqueado (límite)",
  "auditEvent.logout": "Cierre de sesión",
  "auditEvent.token.refresh": "Sesión renovada",
  "auditEvent.session.revoked": "Sesiones revocadas",
  "auditEvent.analyze.start": "Análisis iniciado",
  "auditEvent.finding.status": "Hallazgo actualizado",
  "auditEvent.fix.generate": "Corrección generada",
  "auditEvent.fix.cached": "Corrección reutilizada",
  "auditEvent.analyze.done": "Análisis completado",
  "auditEvent.analysis.delete": "Análisis eliminado",
  "auditEvent.analysis.export": "Hallazgos exportados",
  "auditEvent.pr.open": "PR abierto",
  "auditEvent.pr.batch": "PR en lote",
  "auditEvent.token.create": "Token creado",
  "auditEvent.token.delete": "Token eliminado",
  "auditEvent.account.update": "Cuenta actualizada",
  "auditEvent.user.create": "Usuario creado",
  "auditEvent.user.role.update": "Rol cambiado",
  "auditEvent.user.delete": "Usuario eliminado",

  "monitoring.subtitle":
    "Traza de auditoría de todo lo que ocurre en la plataforma.",
  "monitoring.searchPlaceholder": "Buscar por evento o detalle…",
  "monitoring.category": "Categoría",
  "monitoring.empty": "Ningún registro para los filtros actuales.",
  "monitoring.colWhen": "Cuándo",
  "monitoring.colEvent": "Evento",
  "monitoring.colDetail": "Detalle",
  "monitoring.colOrigin": "Origen",
  "monitoring.loadFailed": "No se pudieron cargar los registros.",
  "auditCategory.auth": "Autenticación",
  "auditCategory.analise": "Análisis",
  "auditCategory.pr": "Pull Requests",
  "auditCategory.conta": "Cuenta",
  "auditCategory.usuario": "Usuarios",
  "auditCategory.sistema": "Sistema",
  "adminAnalyses.subtitle": "Todos los análisis de todos los usuarios.",
  "adminAnalyses.empty": "No se encontró ningún análisis.",

  "adminUsers.subtitle": "Todas las cuentas — gestiona roles y accesos.",
  "adminUsers.searchPlaceholder": "Buscar por nombre o correo…",
  "adminUsers.empty": "No se encontró ningún usuario.",
  "adminUsers.colUser": "Usuario",
  "adminUsers.colPrs": "PRs",
  "adminUsers.colLastActivity": "Última actividad",
  "adminUsers.you": "tú",
  "adminUsers.deleteUser": "Eliminar usuario",
  "adminUsers.cannotDeleteSelf": "No puedes eliminarte a ti mismo",
  "adminUsers.deleteConfirm":
    "¿Eliminar \"{name}\"? La cuenta se desactiva (soft delete) y la persona ya no podrá entrar. Sus análisis permanecen en el historial.",
  "adminUsers.loadFailed": "No se pudieron cargar los usuarios.",
  "adminUsers.roleFailed": "No se pudo cambiar el rol.",
  "adminUsers.deleteFailed": "No se pudo eliminar el usuario.",

  "admin.dashTitle": "Panel global",
  "admin.dashSubtitle":
    "Vista consolidada de todos los usuarios, análisis y correcciones.",
  "admin.metricsFailed": "No se pudieron cargar las métricas.",
  "admin.last7d": "en los últimos 7 días",
  "admin.running": "en curso",
  "admin.doneCount": "completados",
  "admin.errorCount": "con error",
  "admin.sumOfAll": "Suma de todos los análisis.",
  "admin.noFindings": "Todavía no hay hallazgos registrados.",
  "admin.usersHint": "{n} cuenta(s) — ver métricas por usuario",
  "admin.analysesHint": "{n} análisis de todos los usuarios",

  "account.kicker": "Configuración",
  "account.subtitle": "Tus datos de acceso y los tokens de GitHub.",
  "account.basics": "Datos básicos",
  "account.name": "Nombre",
  "account.login": "Usuario (correo)",
  "account.loginHelp": "Cambiar el usuario",
  "account.loginHelpText":
    "Este correo es tu usuario. Para cambiarlo, confirma con la contraseña actual. Los próximos inicios de sesión usan el nuevo correo.",
  "account.currentPasswordToConfirm":
    "Contraseña actual (para confirmar el nuevo usuario)",
  "account.currentPasswordPlaceholder": "tu contraseña actual",
  "account.saveProfile": "Guardar datos",
  "account.changePassword": "Cambiar contraseña",
  "account.currentPassword": "Contraseña actual",
  "account.newPassword": "Nueva contraseña",
  "account.confirmNewPassword": "Confirmar nueva contraseña",
  "account.min8": "mínimo 8 caracteres",
  "account.tokens": "Tokens de GitHub",
  "account.tokensHelp": "Tokens cifrados",
  "account.tokensHelpText":
    "Los tokens se guardan cifrados (AES-256-GCM) y nunca vuelven en texto plano. Solo mostramos el nombre y los últimos 4 caracteres. Puedes tener varios y elegir cuál usar al iniciar un análisis.",
  "account.tokensHint":
    "Guardados cifrados; se usan para clonar repositorios privados y abrir PRs.",
  "account.token": "Token",
  "account.tokenNamePlaceholder": "Ej.: PAT personal",
  "account.tokenPlaceholder": "ghp_…",
  "account.save": "Guardar",
  "account.noTokens": "Todavía no hay tokens guardados.",
  "account.createdAt": "Creado",
  "account.lastUsed": "Último uso",
  "account.remove": "Quitar",
  "account.nothingToUpdate": "Nada que actualizar.",
  "account.needCurrentPassword":
    "Indica la contraseña actual para cambiar el usuario (correo).",
  "account.profileUpdated": "Datos actualizados.",
  "account.updateFailed": "No se pudo actualizar.",
  "account.enterCurrentPassword": "Indica la contraseña actual.",
  "account.newPasswordTooShort":
    "La nueva contraseña necesita al menos 8 caracteres.",
  "account.confirmMismatch": "La confirmación no coincide.",
  "account.passwordChanged": "Contraseña cambiada correctamente.",
  "account.changePasswordFailed": "No se pudo cambiar la contraseña.",
  "account.tokenSaved": "Token guardado de forma segura (cifrado).",
  "account.saveTokenFailed": "No se pudo guardar el token.",
  "account.removeTokenConfirm":
    "¿Quitar este token? Los análisis futuros ya no podrán usarlo.",
  "account.removeTokenFailed": "No se pudo quitar el token.",
  "account.loadTokensFailed": "No se pudieron cargar los tokens.",
  "account.language": "Idioma de la interfaz",
  "account.languageHint":
    "Vale para la interfaz y para los textos generados por IA en los próximos análisis.",

  // ---- Analizadores ----
  "analyzer.threat.name": "Modelado de amenazas",
  "analyzer.threat.desc":
    "Lee la descripción del sistema y plantea amenazas y requisitos de seguridad. No necesita código.",
  "analyzer.sast.name": "Vulnerabilidades de código",
  "analyzer.sast.desc": "Busca patrones inseguros en el código fuente con Opengrep/Semgrep.",
  "analyzer.sca.name": "Dependencias vulnerables",
  "analyzer.sca.desc": "Busca CVE conocidos en los paquetes declarados, con Trivy.",
  "analyzer.business.name": "Reglas de negocio",
  "analyzer.business.desc":
    "Revisión por IA de lo que los escáneres no detectan: regla de negocio violada, IDOR y autorización.",
  "analyzer.skills.name": "Skills y prompts",
  "analyzer.skills.desc":
    "Analiza skills en busca de prompt injection, exfiltración y backdoors.",

  "analyzer.reason.not_selected": "No seleccionado en esta ejecución.",
  "analyzer.reason.no_workspace": "Necesita código: indica un repositorio o un directorio.",
  "analyzer.reason.no_input": "Falta la entrada que consume este analizador.",
  "analyzer.reason.binary_missing": "No se encontró el ejecutable {bin} en este equipo.",
  "analyzer.reason.engine_off": "Desactivado por configuración.",
  "analyzer.reason.no_ai_key": "Necesita una clave de IA y no hay ninguna configurada.",

  "analyzer.degraded.threat":
    "El modelado de amenazas no formó parte de esta ejecución: no había requisitos declarados que verificar.",
  "analyzer.degraded.sast":
    "El analizador de código no formó parte de esta ejecución: los hallazgos no se deduplicaron contra él.",
  "analyzer.degraded.sca":
    "El analizador de dependencias no formó parte de esta ejecución: los hallazgos no se deduplicaron contra él.",

  "fix.cannot.noFile": "El hallazgo no señala ningún archivo que corregir.",
  "fix.cannot.noSnippet":
    "El hallazgo no trae ni fragmento ni ubicación — no hay nada que corregir con seguridad.",
  "fix.cannot.noWorkspace": "Sin acceso al código: indica el repositorio o abre el proyecto.",

  // ---- Árbol lateral de VS Code ----
  "tree.state.unavailable": "no disponible",
  "tree.state.running": "analizando…",
  "tree.state.clean": "nada encontrado",
  "tree.state.failed": "falló",
  "tree.findings.one": "1 hallazgo",
  "tree.findings.many": "{n} hallazgos",
  "tree.total.one": "1 hallazgo en total",
  "tree.total.many": "{n} hallazgos en total",
  "tree.signedInAs": "Conectado como {email}",
  "tree.action.describeSystem": "Describir el sistema…",
  "tree.action.installBinary": "Cómo instalar {bin}",
  "tree.action.openFolder": "Abrir una carpeta…",
  "tree.action.openSkill": "Abrir el archivo de la skill…",
  "tree.action.useAccountAi": "Usar la IA de mi cuenta…",
  "tree.action.enable": "Habilitar en la configuración…",

  // ---- Selector de analizadores (Pantalla 1) ----
  "select.title": "Qué analizar",
  "select.hint":
    "Cada análisis se ejecuta por su cuenta. Elige solo lo que necesitas ahora — el resto no gasta tiempo ni IA.",
  "select.all": "Seleccionar todo",
  "select.none": "Limpiar selección",
  "select.chosen": "{n} de {total} seleccionados",
  "select.unavailable": "No disponible",
  "select.needsRepo": "Necesita un repositorio",
  "select.fixes": "Corrige lo que encuentra",
  "select.empty": "Elige al menos un analizador para empezar.",
  "select.loading": "Comprobando qué está disponible…",
  "select.notRunHere": "No se ejecutó en este análisis.",

  // ---- App de terminal (packages/cli) ----
  "cli.clean": "limpio",
  "cli.noFindings": "Ningún hallazgo. 🎉",
  "cli.col.severity": "SEV",
  "cli.col.location": "ARCHIVO",
  "cli.col.rule": "REGLA",
  "cli.col.title": "PROBLEMA",
  "cli.failOnHit": "{n} hallazgo(s) en {sev} o peor — saliendo con código 1.",
  "cli.failOnClear": "Nada en {sev} o peor.",
  "cli.sarifWritten": "SARIF guardado en {file}",
  "cli.list.title": "Analizadores disponibles",
  "cli.doctor.analyzers": "Analizadores",

  "cli.doctor.aiRemote": "por tu cuenta ({server})",
  "cli.doctor.aiLocal": "clave local",
  "cli.doctor.aiNone": "sin clave local y sin sesión — ejecuta `starguard login`",

  // ---- Hook de pre-commit ----
  "cli.hook.instalado": "Hook de pre-commit instalado.",
  "cli.hook.atualizado": "Hook de pre-commit actualizado.",
  "cli.hook.removido": "Hook de pre-commit eliminado.",
  "cli.hook.blockHint":
    "AVISA y deja hacer commit. Para bloquear: git config starguard.hookBlocks true",
  "cli.hook.notARepo": "Este directorio no es un repositorio git.",
  "cli.hook.foreign":
    "Ya existe un hook de pre-commit de otra herramienta en {path}. No lo sobrescribiré — llama a `starguard scan . --only sast,sca --no-ai` desde él.",
  "cli.hook.notInstalled": "No hay ningún hook de StarGuard instalado aquí.",

  // ---- Consentimiento de la IA por cuenta (el código sale del equipo) ----
  "consent.title": "¿Usar la IA con tu cuenta de StarGuard?",
  "consent.detail":
    "Fragmentos del código analizado se enviarán al servidor de StarGuard y de ahí al modelo de IA. El servidor registra quién lo pidió, qué repositorio y cuánto costó — NUNCA el código, que se descarta tras el análisis. Si prefieres que nada salga de este equipo, cancela y configura una clave de IA local.",
  "consent.accept": "Enviar y continuar",

  "auth.required":
    "Inicia sesión con tu cuenta de StarGuard para usar la extensión. Si aún no tienes una, usa 'StarGuard: solicitar acceso'.",
  "cli.fix.noTarget": "Ningún hallazgo corregible coincide con los filtros.",
  "cli.fix.noFixer": "este analizador no propone correcciones.",
  "cli.fix.noChange": "la corrección no cambió nada — no hay qué aplicar.",
  "cli.fix.dryRun": "simulación: usa --write para guardar en disco.",
  "cli.fix.applied": "aplicado.",
  "cli.fix.total": "{n} corrección(es) guardada(s).",
  "cli.help":
    "  starguard — análisis de seguridad en la terminal\n\n  USO\n    starguard scan [objetivo]    objetivo = directorio (por defecto: .) o URL de GitHub\n    starguard skills <archivos>  valida skills, sin necesidad de repositorio\n    starguard fix [ids]          propone corrección; sin id, corrige el más grave\n    starguard doctor             qué está instalado y configurado\n    starguard list               los analizadores y qué hace cada uno\n\n  ELIGE QUÉ EJECUTAR\n    --only sast,sca              solo estos analizadores\n    --skip business              todos menos estos\n\n  SALIDA\n    --json                       resultado estructurado (claves estables)\n    --sarif <archivo>            SARIF para GitHub Code Scanning\n    --fail-on critical|high|…    sale con código 1 si hay hallazgos así\n    --lang pt-BR|en|es           idioma de la salida\n\n  CORRECCIÓN\n    --write                      guarda en disco (por defecto simula)\n    --all --severity high        corrige todo desde esta severidad\n\n  OTROS\n    --no-ai                      no usa ningún modelo\n    --token <t>                  token de GitHub (o GITHUB_TOKEN)\n    -d, --description <texto>    descripción del sistema (amenazas/reglas)\n\n  CÓDIGOS DE SALIDA\n    0  nada sobre el umbral     1  hallazgos   2  fallo de ejecución",

  // ---- OAuth: consentimiento y dispositivos conectados ----
  "oauth.client.vscode": "StarGuard para VS Code",
  "oauth.client.cli": "StarGuard en la terminal",
  "oauth.client.unknown": "Aplicación desconocida",
  "oauth.scope.analyze": "Analizar el código que abras",
  "oauth.scope.fix": "Proponer correcciones y abrir Pull Requests",
  "oauth.scope.profile": "Ver tu nombre y correo",
  "oauth.title": "Conectar {client}",
  "oauth.subtitle": "Iniciaste sesión como {email}. Si autorizas, esta aplicación podrá:",
  "oauth.approve": "Autorizar",
  "oauth.deny": "Cancelar",
  "oauth.done": "Listo. Puedes volver a {client}.",
  "oauth.manualTitle": "¿No se abrió el editor?",
  "oauth.manualHint": "Copia el código de abajo y pégalo en StarGuard, en «Pegar el código».",
  "oauth.copy": "Copiar",
  "oauth.copied": "Copiado",

  "auth.waiting": "StarGuard: completa la autorización en el navegador.",
  "auth.pasteCode": "Pegar el código",
  "auth.pastePrompt": "Pega el código mostrado en el navegador",
  "auth.pasteInvalid": "Esto no parece el código del navegador.",
  "auth.cancelled": "Autorización cancelada.",
  "auth.readAccountFailed": "No se pudo leer la cuenta.",
  "auth.mismatch": "La respuesta no corresponde a esta solicitud de inicio de sesión.",
  "auth.timeout": "Se agotó el tiempo esperando la autorización en el navegador.",
  "auth.failed": "StarGuard: no se pudo iniciar sesión. {erro}",
  "auth.connected": "StarGuard: sesión iniciada como {email}.",
  "auth.signedOut":
    "StarGuard: sesión cerrada en este editor. Para terminar la sesión en el servidor, revoca el dispositivo en Cuenta.",

  "oauth.opening": "Autorizado. Abriendo {client}…",
  "oauth.openApp": "Abrir {client}",
  "oauth.openHint":
    "Si no ocurre nada en unos segundos, pulsa el botón de arriba: el navegador solo abre una aplicación tras un clic tuyo. Te pedirá confirmación, y el editor también.",
  "oauth.openExpires": "Este enlace es válido durante 2 minutos.",
  "oauth.denied": "Autorización cancelada. No se conectó nada.",
  "oauth.failed": "No se pudo completar la autorización.",
  "oauth.invalidRequest":
    "Solicitud de autorización inválida. No proviene de una aplicación reconocida — no autorices.",
  "oauth.warning":
    "Autoriza solo si TÚ acabas de iniciar esta conexión desde la aplicación.",
  "oauth.devices": "Dispositivos conectados",
  "oauth.devicesHint":
    "Aplicaciones con acceso a tu cuenta. Revoca lo que no reconozcas — el acceso se corta al instante.",
  "oauth.devicesEmpty": "Ningún dispositivo conectado.",
  "oauth.lastUsed": "Último uso: {when}",
  "oauth.connectedAt": "Conectado el {when}",
  "oauth.revokeDevice": "Revocar",
  "oauth.revokeConfirm": "¿Revocar el acceso de este dispositivo? Tendrá que entrar de nuevo.",
  "oauth.revoked": "Acceso revocado.",
  "oauth.revokeFailed": "No se pudo revocar el acceso.",
  "err.oauthClient": "Aplicación no reconocida.",
  "err.oauthRedirect": "Destino de retorno no permitido para esta aplicación.",
  "err.oauthPkce": "Esta aplicación usa un método de seguridad que no aceptamos.",

  // ---- Autenticación en la terminal ----
  "cli.login.opening": "Abriendo el navegador para iniciar sesión…",
  "cli.login.orOpen": "Si no se abre, entra en:",
  "cli.login.done": "Conectado como {email}.",
  "cli.logout.done": "Credencial eliminada de este equipo.",
  "cli.logout.hint":
    "La sesión en el servidor sigue activa hasta que expire. Si sospechas de una filtración, revócala en Cuenta → Dispositivos conectados.",
  "cli.whoami.anonymous": "No conectado. Ejecuta `starguard login`.",
  "cli.whoami.expired":
    "Sesión finalizada (revocada, contraseña cambiada o credencial reutilizada). Ejecuta `starguard login`.",
  "cli.whoami.as": "Conectado como {email}.",
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  "pt-BR": PT_BR,
  en: EN,
  es: ES,
};
