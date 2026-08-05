// ============================================================
// StarGuard no VS Code.
//
// A extensão roda `@starguard/core` DENTRO do extension host — mesmo processo,
// sem servidor e sem banco. O código nunca sai da máquina, e por isso a
// análise funciona em projeto que ainda não foi enviado para lugar nenhum.
//
// O que ela acrescenta sobre o CLI é onde o resultado aparece: cada achado
// vira um `Diagnostic` no painel Problemas, com arquivo e linha que o próprio
// analisador já produz, e a correção vira uma lâmpada (CodeAction) que mostra
// o diff ANTES de escrever. É a mesma separação `propose`/`apply` do núcleo —
// aqui ela é a diferença entre "revisei e aceitei" e "a ferramenta mexeu no
// meu código".
//
// Uma coleção de diagnósticos POR ANALISADOR, e não uma só: rodar apenas o
// Trivy não pode apagar os achados do Semgrep da execução anterior. Essa é a
// tradução, para o editor, da mesma independência que o orquestrador garante.
// ============================================================
import * as vscode from "vscode";
import { plan as montarPlano, run as executar } from "@starguard/core/orchestrator";
import { allAnalyzers, getAnalyzer } from "@starguard/core/registry";
import { openWorkspace } from "@starguard/core/workspace";
import { translate } from "@starguard/core/i18n/translate";
import { normalizeLocale, type Locale } from "@starguard/core/i18n/config";
import type { MessageKey } from "@starguard/core/i18n/messages";
import { reasonKey } from "@starguard/core/compat";
import { ANALYZER_IDS, type AnalyzerId } from "@starguard/core/types";
import type {
  AnalysisRun,
  ExecutionPlan,
  FixableFinding,
  PlanEntry,
  Workspace,
} from "@starguard/core/contracts";
import { achadosDe, type Achado } from "./findings.js";
import { StarGuardAuthProvider, definirLog, pedirLogin, sessaoAtual } from "./auth.js";
import { setAiTransport } from "@starguard/core/ai-transport";
import { setScanTransport } from "@starguard/core/scan-transport";
import { cfg, servidor, urlDeAcesso } from "./config.js";
import { usingRemoteScan } from "@starguard/core/scan-transport";
import {
  PainelStarGuard,
  type CartaoDeAnalisador,
  type GanchosDoPainel,
  type ResultadoNaTela,
} from "./painel.js";
import type { TextosDoPainel } from "./painel-html.js";

let saida: vscode.OutputChannel;
let colecoes: Map<AnalyzerId, vscode.DiagnosticCollection>;
let painel: PainelStarGuard;
/** Cancela a análise em curso — o botão do painel vira isto. */
let cancelamento: vscode.CancellationTokenSource | undefined;
/** O contexto da ativação, para o consentimento chegar onde é decidido. */
let ctxGlobal: vscode.ExtensionContext;
/** Último achado por chave de diagnóstico — a lâmpada precisa reencontrá-lo. */
const achadosPorChave = new Map<string, Achado>();

function locale(): Locale {
  return normalizeLocale(cfg().get<string>("locale"));
}

function t(k: MessageKey, v?: Record<string, string | number>): string {
  return translate(locale(), k, v);
}

/**
 * As configurações de caminho viram variáveis de ambiente porque é assim que o
 * núcleo as lê (`BIN` em `config.ts`). Passá-las por parâmetro exigiria um
 * canal novo em todo o motor para servir só a extensão.
 */
function aplicarConfiguracao(): void {
  const semgrep = cfg().get<string>("semgrepPath")?.trim();
  const trivy = cfg().get<string>("trivyPath")?.trim();
  if (semgrep) {
    process.env.SEMGREP_BIN = semgrep;
    process.env.OPENGREP_BIN = semgrep;
  }
  if (trivy) process.env.TRIVY_BIN = trivy;
}

/** Chave do consentimento, no estado global da extensão. */
const CONSENTIU = "starguard.consentiuIaRemota";

/**
 * A IA pela conta exige CONSENTIMENTO explícito, uma vez.
 *
 * No transporte remoto o trecho de código SAI da máquina: vai ao servidor do
 * StarGuard e de lá ao modelo. Isso não pode ser ligado em silêncio só porque
 * a pessoa fez login — login é "quem sou eu", não "pode mandar meu código para
 * fora". São duas autorizações diferentes e merecem duas perguntas.
 *
 * A resposta fica guardada: perguntar a cada análise viraria ruído, e ruído
 * treina as pessoas a clicar sem ler.
 */
async function consentiuIaRemota(ctx: vscode.ExtensionContext): Promise<boolean> {
  if (ctx.globalState.get<boolean>(CONSENTIU)) return true;

  const sim = t("consent.accept");
  const escolha = await vscode.window.showWarningMessage(
    t("consent.title"),
    { modal: true, detail: t("consent.detail") },
    sim
  );
  if (escolha !== sim) return false;
  await ctx.globalState.update(CONSENTIU, true);
  return true;
}

/**
 * Liga a IA pela conta, se houver login E consentimento.
 *
 * Sem os dois, segue valendo a chave local — quem já usava a extensão sem
 * conta não tem o comportamento alterado por baixo.
 */
async function configurarIa(ctx: vscode.ExtensionContext): Promise<void> {
  const sessao = await sessaoAtual();
  if (!sessao) return;
  if (!(await consentiuIaRemota(ctx))) return;
  ligarTransporteRemoto();
}

function ligarTransporteRemoto(): void {
  // Função, e não string: o access dura 15 min e uma análise longa atravessa
  // a expiração. `getSession` renova (e rotaciona o refresh) sob demanda.
  const getToken = async () => (await sessaoAtual())?.accessToken ?? null;
  const baseUrl = servidor();

  setAiTransport({ kind: "remote", baseUrl, getToken });
  // Os SCANNERS também. É o que permite não instalar `opengrep` nem `trivy`:
  // quem tem os binários é a nossa imagem. Ver `packages/core/src/bundle.ts`.
  setScanTransport({ kind: "remote", baseUrl, getToken });
}

/**
 * A mesma decisão, mas SEM perguntar nada.
 *
 * A árvore precisa saber se a IA pela conta está valendo para pintar os
 * analisadores certos como disponíveis — e desenhar um painel não é hora de
 * abrir um modal pedindo autorização para mandar código para fora. Aqui só se
 * lê um consentimento que já foi dado; quem ainda não deu continua vendo o
 * analisador bloqueado, com o convite explícito no filho clicável.
 */
async function ligarIaSeJaConsentiu(): Promise<void> {
  if (!ctxGlobal?.globalState.get<boolean>(CONSENTIU)) return;
  if (!(await sessaoAtual())) return;
  ligarTransporteRemoto();
}

/**
 * O portão: sem conta, a extensão não analisa nada.
 *
 * Duas coisas acontecem aqui, e a ordem importa. Primeiro o `setContext`, que
 * é o que faz a árvore mostrar a tela de "Entrar" em vez de uma lista vazia
 * sem explicação — o jeito idiomático do VS Code de dizer "falta uma etapa".
 * Depois a resposta, que cada comando usa para desistir cedo.
 *
 * Ressalva honesta, escrita onde se decide e não só no README: **este portão é
 * de produto, não é barreira técnica.** O `.vsix` é um zip; quem quiser remove
 * esta função e reempacota. O que é imposto DE VERDADE está do outro lado — a
 * IA (regras de negócio, ameaças, correções) passa pelo nosso servidor e morre
 * sem token válido. Semgrep e Trivy rodam com binários da máquina de quem usa,
 * e nenhum código nosso pode impedir isso.
 */
async function exigirConta(pedirSeNaoTiver = false): Promise<vscode.AuthenticationSession | undefined> {
  const sessao = pedirSeNaoTiver ? await pedirLogin() : await sessaoAtual();
  await vscode.commands.executeCommand("setContext", "starguard.signedIn", !!sessao);
  return sessao;
}

function raiz(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ------------------------------------------------------------
// Achados -> painel Problemas
// ------------------------------------------------------------

const SEVERIDADE: Record<string, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
  info: vscode.DiagnosticSeverity.Hint,
};

function chaveDe(a: Achado): string {
  return `${a.analyzer}|${a.file}|${a.line ?? 0}|${a.ruleId}`;
}

function publicar(id: AnalyzerId, achados: Achado[], root: string): void {
  const colecao = colecoes.get(id)!;
  const porArquivo = new Map<string, vscode.Diagnostic[]>();

  for (const a of achados) {
    const uri = vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(root), a.file).fsPath);
    // O scanner conta linhas a partir de 1; o editor, de 0. Errar isto põe o
    // sublinhado uma linha acima do problema — e ninguém confia num apontador
    // que erra por um.
    const linha = Math.max(0, (a.line ?? 1) - 1);
    const fim = Math.max(linha, (a.endLine ?? a.line ?? 1) - 1);

    const d = new vscode.Diagnostic(
      new vscode.Range(linha, 0, fim, Number.MAX_SAFE_INTEGER),
      a.title + (a.description ? `\n\n${a.description}` : ""),
      SEVERIDADE[a.severity] ?? vscode.DiagnosticSeverity.Warning
    );
    // `source` traz o analisador: no painel Problemas dá para filtrar por
    // "starguard/sca" e ver só as dependências.
    d.source = `starguard/${a.analyzer}`;
    d.code = a.cwe ? { value: a.ruleId, target: cweUri(a.cwe) } : a.ruleId;

    const chave = chaveDe(a);
    achadosPorChave.set(chave, a);
    // Guardado no próprio diagnóstico para a CodeAction reencontrar o achado
    // sem depender de posição — o arquivo pode ter sido editado no meio.
    (d as vscode.Diagnostic & { sgKey?: string }).sgKey = chave;

    const lista = porArquivo.get(uri.fsPath) ?? [];
    lista.push(d);
    porArquivo.set(uri.fsPath, lista);
  }

  colecao.clear();
  for (const [caminho, ds] of porArquivo) {
    colecao.set(vscode.Uri.file(caminho), ds);
  }
}

function cweUri(cwe: string): vscode.Uri {
  const n = cwe.replace(/\D/g, "");
  return vscode.Uri.parse(`https://cwe.mitre.org/data/definitions/${n}.html`);
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------

async function analisar(select: AnalyzerId[]): Promise<void> {
  // `true`: quem clicou em analisar está pedindo para usar a ferramenta, então
  // abrir o login é a resposta esperada — não uma interrupção.
  if (!(await exigirConta(true))) {
    void vscode.window.showWarningMessage(t("auth.required"));
    return;
  }

  const root = raiz();
  if (!root) {
    void vscode.window.showWarningMessage(t("analyzer.reason.no_workspace"));
    return;
  }
  aplicarConfiguracao();
  // Antes de montar o plano: o `probe` de `threat` e `business` pergunta se há
  // IA disponível, e com o transporte remoto a resposta muda.
  await configurarIa(ctxGlobal);

  const descricao = cfg().get<string>("systemDescription")?.trim() || undefined;
  const skills = await skillsAbertas(select);

  const execPlan = await montarPlano({
    select,
    source: { type: "local", path: root },
    locale: locale(),
    systemDescription: descricao,
    skills,
  });

  ultimoPlano = execPlan;
  await painel.atualizar({ erro: null });
  relatarPulados(execPlan);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "StarGuard" },
    async (progresso) => {
      // O workspace é aberto AQUI e passado ao orquestrador: entre uma
      // execução e outra o diretório é o mesmo, e reabri-lo a cada clique na
      // árvore seria desperdício.
      const ws = await openWorkspace({ type: "local", path: root });
      try {
        const run = await executar(execPlan, {
          workspace: ws,
          systemDescription: descricao,
          skills,
          sinks: [
            {
              on: (e) => {
                if (e.type === "analyzer:start") {
                  progresso.report({
                    message: t(`analyzer.${e.id}.name` as MessageKey),
                  });
                  painel.progresso(e.id, "rodando", true);
                }
                if (e.type === "analyzer:done" || e.type === "analyzer:error") {
                  painel.progresso(e.id, e.type === "analyzer:done" ? "pronto" : "erro", true);
                }
              },
            },
          ],
        });
        aplicarResultado(run, root, select);
      } finally {
        await ws?.dispose();
      }
    }
  );
}

/**
 * Quando `skills` está no plano, o arquivo ABERTO é a skill a validar.
 *
 * É o caminho natural no editor: quem está escrevendo um prompt quer validar
 * aquele prompt, não procurar um seletor de arquivos. Sem editor aberto, o
 * analisador simplesmente sai do plano por falta de entrada — com motivo.
 */
async function skillsAbertas(
  select: AnalyzerId[]
): Promise<{ name: string; content: string }[] | undefined> {
  if (!select.includes("skills")) return undefined;
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.isUntitled) return undefined;
  return [{ name: doc.fileName.split(/[\\/]/).pop()!, content: doc.getText() }];
}

function aplicarResultado(run: AnalysisRun, root: string, select: AnalyzerId[]): void {
  const achados = achadosDe(run);

  // Só as coleções dos analisadores que RODARAM são reescritas. Rodar o Trivy
  // não pode apagar os achados do Semgrep da execução anterior.
  for (const id of select) {
    const o = run.outcomes[id];
    if (!o || o.status === "skipped") continue;
    publicar(id, achados.filter((a) => a.analyzer === id), root);
  }

  const rodaram = select.filter((id) => {
    const o = run.outcomes[id];
    return !!o && o.status !== "skipped";
  });
  ultimoResultado = montarResultado(achados, rodaram);
  void painel.atualizar({ resultado: ultimoResultado });

  for (const o of Object.values(run.outcomes)) {
    if (o.status === "error") {
      saida.appendLine(`[${o.id}] ${o.error}`);
      void vscode.window.showErrorMessage(`StarGuard · ${o.id}: ${o.error?.split("\n")[0]}`);
    }
    // A degradação vira aviso no canal de saída: um resultado parcial
    // silencioso passa por completo.
    for (const d of o.degraded) {
      saida.appendLine(`[${o.id}] ${t(`analyzer.degraded.${d}` as MessageKey)}`);
    }
  }
}

function relatarPulados(execPlan: ExecutionPlan): void {
  for (const e of execPlan.entries) {
    if (e.willRun || e.reason === "not_selected") continue;
    saida.appendLine(
      `[${e.id}] ${t(reasonKey(e.reason!), { bin: e.detail ?? "" })}`
    );
  }
}

// ------------------------------------------------------------
// Correção: lâmpada -> diff -> aplicar
// ------------------------------------------------------------

class CorretorStarGuard implements vscode.CodeActionProvider {
  static readonly tipos = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    _doc: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    ctx: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const acoes: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      const chave = (d as vscode.Diagnostic & { sgKey?: string }).sgKey;
      const achado = chave ? achadosPorChave.get(chave) : undefined;
      if (!achado) continue;

      const analyzer = getAnalyzer(achado.analyzer);
      const fixer = analyzer?.fix;
      if (!fixer) continue;

      // A elegibilidade é perguntada ao CORRETOR do analisador, não adivinhada
      // aqui: é ele que sabe que uma dependência sem versão corrigida não tem
      // correção possível.
      const pode = fixer.can(paraFinding(achado));
      const acao = new vscode.CodeAction(
        pode.ok ? t("fix.title") : t(pode.reasonKey),
        vscode.CodeActionKind.QuickFix
      );
      acao.diagnostics = [d];
      if (pode.ok) {
        acao.command = {
          command: "starguard.fix",
          title: t("fix.title"),
          arguments: [chave],
        };
      } else {
        // Desabilitada COM motivo, em vez de ausente: a lâmpada que some deixa
        // a pessoa achando que a ferramenta não corrige aquilo.
        acao.disabled = { reason: t(pode.reasonKey) };
      }
      acoes.push(acao);
    }
    return acoes;
  }
}

function paraFinding(a: Achado): FixableFinding {
  return {
    id: a.id,
    analyzer: a.analyzer,
    ruleId: a.ruleId,
    title: a.title,
    severity: a.severity,
    file: a.file,
    line: a.line,
    endLine: a.endLine,
    description: a.description,
    suggestion: a.suggestion,
    codeSnippet: a.codeSnippet,
    cwe: a.cwe,
    raw: a.raw,
  };
}

async function corrigir(chave: string): Promise<void> {
  const achado = achadosPorChave.get(chave);
  const root = raiz();
  if (!achado || !root) return;

  const fixer = getAnalyzer(achado.analyzer)?.fix;
  if (!fixer) return;

  aplicarConfiguracao();
  let ws: Workspace | undefined;

  const proposta = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t("fix.generating") },
    async () => {
      ws = await openWorkspace({ type: "local", path: root });
      return fixer.propose(paraFinding(achado), {
        workspace: ws,
        locale: locale(),
        repoUrl: ws?.origin?.url,
      });
    }
  );

  try {
    if (proposta.noChange) {
      void vscode.window.showWarningMessage(t("fix.noChange"));
      return;
    }

    // O diff ANTES de escrever. `propose` não tocou em disco, então mostrar e
    // desistir não deixa rastro — é o que separa "revisei e aceitei" de "a
    // ferramenta mexeu no meu código".
    const principal = proposta.changes[0]!;
    const antes = vscode.Uri.parse(
      `starguard-diff:${encodeURIComponent(principal.file)}?${Buffer.from(
        principal.originalCode
      ).toString("base64")}`
    );
    const depois = vscode.Uri.parse(
      `starguard-diff:${encodeURIComponent(principal.file)} (StarGuard)?${Buffer.from(
        principal.fixedCode
      ).toString("base64")}`
    );
    await vscode.commands.executeCommand(
      "vscode.diff",
      antes,
      depois,
      `${principal.file} — StarGuard`
    );

    const escolha = await vscode.window.showInformationMessage(
      proposta.explanation,
      { modal: false },
      t("fix.apply"),
      t("common.cancel")
    );
    if (escolha !== t("fix.apply")) return;

    await fixer.apply(proposta, ws!);
    void vscode.window.showInformationMessage(t("fix.applied"));

    for (const seg of proposta.followUp ?? []) {
      // O aviso do lockfile precisa aparecer: a correção edita o manifesto e
      // NÃO regera o lock.
      void vscode.window.showWarningMessage(
        t(seg.commandKey, { cmd: seg.command ?? "", manifest: principal.file, lockfile: "" })
      );
    }
  } finally {
    await ws?.dispose();
  }
}

/** Conteúdo virtual do diff — nada disto existe em disco. */
class ProvedorDeDiff implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return Buffer.from(uri.query, "base64").toString("utf8");
  }
}

// ------------------------------------------------------------
// O painel (webview)
// ------------------------------------------------------------

/** Severidade em ordem de gravidade — governa a ordenação e o placar. */
const ORDEM_SEV: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

/** Quais analisadores custam IA. Vira selo no cartão, antes de rodar. */
const CUSTA_IA: Record<string, boolean> = {
  threat: true, business: true, sast: false, sca: false, skills: false,
};

/** Último plano montado: é dele que saem disponibilidade e motivo. */
let ultimoPlano: ExecutionPlan | undefined;
/** Seleção corrente, preservada entre aberturas do painel. */
let selecao: AnalyzerId[] = [];
/** Último resultado, para o painel redesenhar sem reanalisar. */
let ultimoResultado: ResultadoNaTela | null = null;

function textosDoPainel(): TextosDoPainel {
  return {
    titulo: t("panel.signInTitle"),
    entrar: t("oauth.approve") === "" ? "" : t("panel.signInTitle"),
    entrarSub: t("panel.signInSub"),
    solicitar: t("tree.action.openFolder"),
    analisadores: t("panel.analyzers"),
    selecionarTudo: t("panel.selectAll"),
    limpar: t("panel.clearSel"),
    analisar: t("panel.run"),
    analisando: t("panel.running"),
    cancelar: t("common.cancel"),
    descreverSistema: t("panel.describeSystem"),
    descricaoAjuda: t("panel.describeHelp"),
    descricaoVazia: t("panel.describeEmpty"),
    resultado: t("panel.result"),
    semAchados: t("panel.noFindings"),
    aindaNaoRodou: t("panel.notRunYet"),
    usaIa: t("panel.usesAi"),
    noServidor: t("panel.onServer"),
    indisponivel: t("panel.unavailable"),
    corrigir: t("panel.fix"),
    diagnostico: t("panel.doctor"),
    sair: t("panel.signOut"),
    nenhumSelecionado: t("panel.nothingSelected"),
    privacidade: t("panel.privacy"),
  };
}

/** Monta o plano SEM executar — é o que alimenta os cartões. */
async function recarregarPlano(): Promise<void> {
  const root = raiz();
  aplicarConfiguracao();
  // Antes de montar: com o transporte remoto ligado, `sast`/`sca` deixam de
  // exigir binário local e `threat`/`business` deixam de exigir chave de IA.
  await ligarIaSeJaConsentiu();
  ultimoPlano = await montarPlano({
    source: root ? { type: "local", path: root } : { type: "none" },
    locale: locale(),
    systemDescription: cfg().get<string>("systemDescription")?.trim() || undefined,
    // Sinalizador de presença: a skill de verdade é o arquivo aberto.
    skills: vscode.window.activeTextEditor ? [{ name: "aberto", content: "x" }] : undefined,
  });
}

function cartoes(): CartaoDeAnalisador[] {
  const remoto = usingRemoteScan();
  return ANALYZER_IDS.map((id) => {
    const e = ultimoPlano?.entries.find((x) => x.id === id);
    // `not_selected` não é indisponibilidade: o plano de sondagem não pediu
    // nada, e cada cartão é selecionável por conta própria.
    const disponivel = !e || e.willRun || e.reason === "not_selected";
    return {
      id,
      nome: t(`analyzer.${id}.name` as MessageKey),
      desc: t(`analyzer.${id}.desc` as MessageKey),
      disponivel,
      motivo: e && !disponivel ? descreverMotivo(e) : undefined,
      usaIa: !!CUSTA_IA[id],
      remoto: remoto && (id === "sast" || id === "sca"),
    };
  });
}

function montarResultado(achados: Achado[], rodaram: AnalyzerId[]): ResultadoNaTela {
  const contagem: Record<string, number> = {};
  for (const a of achados) contagem[a.severity] = (contagem[a.severity] ?? 0) + 1;

  const rotulos: Record<string, string> = {};
  for (const s of Object.keys(ORDEM_SEV)) rotulos[s] = t(`severity.${s}` as MessageKey);

  return {
    contagem,
    rotulos,
    grupos: rodaram.map((id) => ({
      id,
      nome: t(`analyzer.${id}.name` as MessageKey),
      achados: achados
        .filter((a) => a.analyzer === id)
        .sort(
          (x, y) =>
            (ORDEM_SEV[x.severity] ?? 9) - (ORDEM_SEV[y.severity] ?? 9) ||
            x.file.localeCompare(y.file) ||
            (x.line ?? 0) - (y.line ?? 0)
        )
        .map((a) => ({
          chave: chaveDe(a),
          titulo: a.title,
          local: a.line ? `${a.file}:${a.line}` : a.file,
          severidade: a.severity,
        })),
    })),
  };
}

/**
 * Entrar na conta — um caminho só para o botão do painel e para o comando.
 *
 * O `try` existe porque sem ele o erro subia para o VS Code e virava um aviso
 * genérico de "o comando falhou", ou nada. Quem clicou em Entrar via a tela
 * continuar igual, sem saber se estava esperando ou se tinha dado errado.
 * Ver AUDITORIA.md#PEND-37.
 */
async function comandoEntrar(): Promise<void> {
  try {
    const s = await exigirConta(true);
    if (!s) return;
    void vscode.window.showInformationMessage(
      t("auth.connected", { email: s.account.label })
    );
    await painel.atualizar();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    saida.appendLine(`[auth] Falhou: ${msg}`);
    const verLog = t("common.details");
    const escolha = await vscode.window.showErrorMessage(t("auth.failed", { erro: msg }), verLog);
    if (escolha === verLog) saida.show();
  }
}

function ganchosDoPainel(): GanchosDoPainel {
  return {
    textos: textosDoPainel,

    estado: async () => {
      const sessao = await sessaoAtual();
      await vscode.commands.executeCommand("setContext", "starguard.signedIn", !!sessao);
      if (sessao) await recarregarPlano();
      return {
        logado: !!sessao,
        conta: sessao?.account.label,
        analisadores: sessao ? cartoes() : [],
        descricao: cfg().get<string>("systemDescription") ?? "",
        // Primeira abertura: já vêm marcados os que não custam IA. É o padrão
        // que a configuração `analyzers.enabled` sempre declarou, e evita a
        // tela abrir com o botão desabilitado e nada explicando o porquê.
        selecionados: selecao.length
          ? selecao
          : (cfg().get<AnalyzerId[]>("analyzers.enabled") ?? ["sast", "sca"]),
      };
    },

    aoEntrar: async () => {
      await comandoEntrar();
    },
    aoSair: async () => {
      await vscode.commands.executeCommand("workbench.action.manageTrustedExtensionsForAccount");
    },
    aoSolicitarAcesso: async () => {
      await vscode.env.openExternal(vscode.Uri.parse(urlDeAcesso()));
    },
    aoDiagnostico: async () => {
      await vscode.commands.executeCommand("starguard.doctor");
    },
    aoAnalisar: async (ids, descricao) => {
      selecao = ids;
      // A descrição digitada no painel vale para ESTA execução mesmo que o
      // campo ainda não tenha perdido o foco — quem escreveu e clicou em
      // analisar espera que o texto conte.
      if (descricao.trim() !== (cfg().get<string>("systemDescription") ?? "").trim()) {
        await cfg().update(
          "systemDescription",
          descricao,
          vscode.ConfigurationTarget.Workspace
        );
      }
      await analisar(ids);
    },
    aoCancelar: () => {
      cancelamento?.cancel();
    },
    aoAbrir: async (chave) => {
      const a = achadosPorChave.get(chave);
      const root = raiz();
      if (!a || !root) return;
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), a.file);
      const linha = Math.max(0, (a.line ?? 1) - 1);
      await vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(linha, 0, linha, 0),
      });
    },
    aoCorrigir: async (chave) => {
      await corrigir(chave);
    },
    aoSalvarDescricao: async (texto) => {
      await cfg().update("systemDescription", texto, vscode.ConfigurationTarget.Workspace);
    },
    aoMudarSelecao: async (ids) => {
      selecao = ids;
    },
  };
}



function descreverMotivo(e: PlanEntry): string | undefined {
  if (e.willRun || !e.reason || e.reason === "not_selected") return undefined;
  return translate(
    normalizeLocale(vscode.workspace.getConfiguration("starguard").get<string>("locale")),
    reasonKey(e.reason),
    { bin: e.detail ?? "" }
  );
}

// ------------------------------------------------------------
// Ativação
// ------------------------------------------------------------

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  ctxGlobal = ctx;
  saida = vscode.window.createOutputChannel("StarGuard");
  colecoes = new Map(
    ANALYZER_IDS.map((id) => [
      id,
      vscode.languages.createDiagnosticCollection(`starguard/${id}`),
    ])
  );
  painel = new PainelStarGuard(ctx.extensionUri, ganchosDoPainel());

  // O log do login vai para o MESMO canal da análise. Um segundo canal só
  // para autenticação obrigaria quem relata um problema a saber de antemão
  // qual dos dois abrir.
  definirLog((m) => saida.appendLine(`[auth] ${m}`));

  // A conta aparece no menu Contas do editor, ao lado do GitHub — e sai de
  // lá também. O provider guarda o refresh no chaveiro do sistema.
  const auth = new StarGuardAuthProvider(ctx);
  ctx.subscriptions.push(auth);

  // A IA é da conta, e só. Não há chave própria para configurar aqui.
  //
  // Uma versão anterior guardava uma `ANTHROPIC_API_KEY` no SecretStorage.
  // Apagamos a que tiver sobrado: sem comando para ver ou trocar, ela seria
  // um segredo órfão no chaveiro do sistema que a extensão continuaria
  // injetando em `process.env` sem ninguém saber. Deixar para trás um segredo
  // invisível é pior que remover a funcionalidade.
  await ctx.secrets.delete("starguard.apiKey");

  ctx.subscriptions.push(
    saida,
    ...colecoes.values(),
    vscode.window.registerWebviewViewProvider(PainelStarGuard.ID, painel, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      "starguard-diff",
      new ProvedorDeDiff()
    ),
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new CorretorStarGuard(), {
      providedCodeActionKinds: CorretorStarGuard.tipos,
    }),

    vscode.commands.registerCommand("starguard.runAll", () =>
      analisar(
        (cfg().get<AnalyzerId[]>("analyzers.enabled") ?? ["sast", "sca"]).filter((id) =>
          (ANALYZER_IDS as readonly string[]).includes(id)
        )
      )
    ),

    vscode.commands.registerCommand("starguard.runAnalyzer", async () => {
      const escolha = await vscode.window.showQuickPick(
        allAnalyzers().map((a) => ({
          label: t(`analyzer.${a.id}.name` as MessageKey),
          detail: t(`analyzer.${a.id}.desc` as MessageKey),
          id: a.id,
        })),
        { placeHolder: t("select.title") }
      );
      if (escolha) await analisar([escolha.id]);
    }),

    vscode.commands.registerCommand("starguard.validateCurrentSkill", () =>
      analisar(["skills"])
    ),

    vscode.commands.registerCommand("starguard.fix", (chaveDoAchado: string) =>
      corrigir(chaveDoAchado)
    ),

    vscode.commands.registerCommand("starguard.clear", () => {
      for (const c of colecoes.values()) c.clear();
      achadosPorChave.clear();
      ultimoResultado = null;
      void painel.atualizar({ resultado: null });
    }),

    // A saída oferecida no analisador bloqueado por falta de IA. É o mesmo
    // consentimento de sempre — só que pedido no momento em que a pessoa
    // demonstrou querer aquele analisador, e não no meio de uma análise.
    vscode.commands.registerCommand("starguard.enableAccountAi", async () => {
      if (!(await exigirConta(true))) return;
      await configurarIa(ctxGlobal);
      await painel.atualizar();
    }),

    vscode.commands.registerCommand("starguard.requestAccess", async () => {
      // Quem instalou da Marketplace sem conta precisa de uma saída que não
      // seja a aba de avaliações.
      await vscode.env.openExternal(vscode.Uri.parse(urlDeAcesso()));
    }),

    vscode.commands.registerCommand("starguard.signIn", comandoEntrar),

    vscode.commands.registerCommand("starguard.signOut", async () => {
      // O editor cuida da confirmação e chama `removeSession` do provider.
      await vscode.commands.executeCommand("workbench.action.manageTrustedExtensionsForAccount");
    }),

    vscode.commands.registerCommand("starguard.doctor", async () => {
      saida.clear();
      saida.show();
      const conta = await sessaoAtual();
      saida.appendLine(
        conta ? `✔ Conta: ${conta.account.label}` : "✖ Conta: não conectada"
      );
      saida.appendLine("");
      const root = raiz();
      const execPlan = await montarPlano({
        source: root ? { type: "local", path: root } : { type: "none" },
        locale: locale(),
        systemDescription: "presente",
        skills: [{ name: "presente", content: "presente" }],
      });
      for (const e of execPlan.entries) {
        const nome = t(`analyzer.${e.id}.name` as MessageKey);
        saida.appendLine(
          e.willRun
            ? `✔ ${nome} — ${e.detail ?? "ok"}`
            : `✖ ${nome} — ${t(reasonKey(e.reason!), { bin: e.detail ?? "" })}`
        );
      }
    }),

    // O que muda a disponibilidade muda a árvore: caminho de binário, idioma,
    // descrição do sistema e o arquivo aberto (que é a skill a validar).
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("starguard")) void painel.atualizar();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => void painel.atualizar())
  );

  // O estado do portão é resolvido na ativação e a cada mudança de sessão —
  // inclusive quando o refresh é recusado porque alguém revogou o dispositivo
  // no painel. Sem isto, a árvore continuaria oferecendo ▶ para uma sessão que
  // já não existe.
  ctx.subscriptions.push(
    vscode.authentication.onDidChangeSessions(async (e) => {
      if (e.provider.id !== "starguard") return;
      await exigirConta();
      await painel.atualizar();
    })
  );

  await exigirConta();
  await painel.atualizar();
}

export function deactivate(): void {
  for (const c of colecoes?.values() ?? []) c.dispose();
}
