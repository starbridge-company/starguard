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
import { StarGuardAuthProvider, pedirLogin, sessaoAtual } from "./auth.js";
import { setAiTransport } from "@starguard/core/ai-transport";
import { cfg, servidor, urlDeAcesso } from "./config.js";

let saida: vscode.OutputChannel;
let colecoes: Map<AnalyzerId, vscode.DiagnosticCollection>;
let arvore: ArvoreDeAnalisadores;
/**
 * A `TreeView`, e não só o provider: é o objeto que carrega a `description`
 * (a conta, ao lado do título) e o `badge` (o selo numérico sobre o ícone da
 * barra lateral). `registerTreeDataProvider` não devolve nada e por isso não
 * dá acesso a nenhum dos dois.
 */
let painel: vscode.TreeView<No> | undefined;
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
  setAiTransport({
    kind: "remote",
    baseUrl: servidor(),
    // Função: o access dura 15 min e uma análise longa atravessa a expiração.
    // `getSession` renova (e rotaciona o refresh) sob demanda.
    getToken: async () => (await sessaoAtual())?.accessToken ?? null,
  });
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
  // O `setContext` governa os BOTÕES (o ▶, o "analisar tudo"); quem esvazia a
  // árvore é o provider. São dois mecanismos porque o VS Code decide a tela de
  // boas-vindas pelo número de filhos, não por contexto.
  arvore?.definirSessao(!!sessao);
  if (painel) {
    painel.description = sessao ? sessao.account.label : undefined;
  }
  return sessao;
}

/** O selo numérico sobre o ícone da barra lateral. */
function atualizarSelo(): void {
  if (!painel) return;
  const n = arvore.total;
  painel.badge = n
    ? { value: n, tooltip: n === 1 ? t("tree.total.one") : t("tree.total.many", { n }) }
    : undefined;
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

  arvore.atualizarPlano(execPlan);
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
                  arvore.marcarRodando(e.id);
                }
                if (e.type === "analyzer:done" || e.type === "analyzer:error") {
                  arvore.marcarFim(e.id, e.type === "analyzer:done");
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

  arvore.atualizarResultado(run, achados);
  atualizarSelo();

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
// A árvore
// ------------------------------------------------------------

interface EstadoDoItem {
  id: AnalyzerId;
  disponivel: boolean;
  /** A `UnavailableReason` crua — é ela que decide qual saída oferecer. */
  razao?: PlanEntry["reason"];
  motivo?: string;
  detalhe?: string;
  estado: "ocioso" | "rodando" | "pronto" | "erro";
  achados?: Achado[];
}

/**
 * Um nó da árvore. Três formas, e a terceira é a que muda o caráter do painel.
 *
 * `acao` é a SAÍDA de um analisador bloqueado. Dizer "falta a descrição do
 * sistema" e parar aí transfere para a pessoa o trabalho de descobrir onde se
 * configura isso; um filho clicável que abre exatamente aquele campo fecha o
 * ciclo no lugar onde o problema apareceu.
 */
type No =
  | { tipo: "analisador"; item: EstadoDoItem }
  | { tipo: "achado"; achado: Achado }
  | { tipo: "acao"; rotulo: string; icone: string; comando: vscode.Command };

const ORDEM_SEV: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Cor do ponto de severidade. Usa a paleta do TEMA, não hex fixo. */
const COR_SEV: Record<string, string> = {
  critical: "charts.red",
  high: "charts.red",
  medium: "charts.orange",
  low: "charts.yellow",
  info: "charts.blue",
};

/** Onde se aprende a instalar cada binário que falta. */
const COMO_INSTALAR: Record<string, string> = {
  trivy: "https://trivy.dev/latest/getting-started/installation/",
  opengrep: "https://github.com/opengrep/opengrep#installation",
  semgrep: "https://semgrep.dev/docs/getting-started/quickstart",
};

class ArvoreDeAnalisadores implements vscode.TreeDataProvider<No> {
  private itens = new Map<AnalyzerId, EstadoDoItem>();
  private readonly emissor = new vscode.EventEmitter<No | undefined>();
  readonly onDidChangeTreeData = this.emissor.event;
  /**
   * Sem conta a árvore fica VAZIA — e é isso que faz o `viewsWelcome`
   * aparecer. O VS Code só mostra a tela de boas-vindas quando o provider não
   * devolve nenhum filho da raiz; devolver os cinco analisadores desabilitados
   * escondia o botão "Entrar" e deixava o painel sem saída visível.
   */
  private logado = false;

  constructor() {
    for (const id of ANALYZER_IDS) {
      this.itens.set(id, { id, disponivel: false, estado: "ocioso" });
    }
  }

  definirSessao(entrou: boolean): void {
    this.logado = entrou;
    this.emissor.fire(undefined);
  }

  /** Quanto há no total — alimenta o selo numérico do ícone lateral. */
  get total(): number {
    let n = 0;
    for (const i of this.itens.values()) n += i.achados?.length ?? 0;
    return n;
  }

  async recarregar(): Promise<void> {
    const root = raiz();
    aplicarConfiguracao();
    // A IA pela conta muda a DISPONIBILIDADE: com o transporte remoto ligado,
    // regras de negócio e ameaças rodam sem chave local. Sem esta linha a
    // árvore anunciava "precisa de uma chave de IA" justamente para quem fez
    // login para não precisar de uma.
    await ligarIaSeJaConsentiu();
    const execPlan = await montarPlano({
      source: root ? { type: "local", path: root } : { type: "none" },
      locale: locale(),
      systemDescription: cfg().get<string>("systemDescription")?.trim() || undefined,
      // Sinalizador de presença: a skill de verdade é o arquivo aberto, e a
      // árvore só precisa saber se HÁ um.
      skills: vscode.window.activeTextEditor ? [{ name: "aberto", content: "x" }] : undefined,
    });
    this.atualizarPlano(execPlan);
  }

  atualizarPlano(execPlan: ExecutionPlan): void {
    for (const e of execPlan.entries) {
      const item = this.itens.get(e.id)!;
      // `not_selected` aqui não significa indisponível: a árvore mostra o que
      // PODE rodar, e cada item roda sozinho pelo botão ▶.
      item.disponivel = e.willRun || e.reason === "not_selected";
      item.razao = item.disponivel ? undefined : e.reason;
      item.motivo = descreverMotivo(e);
      item.detalhe = e.detail;
    }
    this.emissor.fire(undefined);
  }

  marcarRodando(id: AnalyzerId): void {
    const i = this.itens.get(id);
    if (i) i.estado = "rodando";
    this.emissor.fire(undefined);
  }

  marcarFim(id: AnalyzerId, ok: boolean): void {
    const i = this.itens.get(id);
    if (i) i.estado = ok ? "pronto" : "erro";
    this.emissor.fire(undefined);
  }

  atualizarResultado(run: AnalysisRun, achados: Achado[]): void {
    for (const [id, item] of this.itens) {
      const o = run.outcomes[id];
      // `skipped` é "não pedi este agora": os achados da execução anterior
      // continuam valendo e não podem ser zerados por baixo.
      if (!o || o.status === "skipped") continue;
      item.achados = achados
        .filter((a) => a.analyzer === id)
        .sort(
          (x, y) =>
            (ORDEM_SEV[x.severity] ?? 9) - (ORDEM_SEV[y.severity] ?? 9) ||
            x.file.localeCompare(y.file) ||
            (x.line ?? 0) - (y.line ?? 0)
        );
    }
    this.emissor.fire(undefined);
  }

  limpar(): void {
    for (const item of this.itens.values()) {
      item.estado = "ocioso";
      item.achados = undefined;
    }
    this.emissor.fire(undefined);
  }

  getChildren(no?: No): No[] {
    if (!no) {
      if (!this.logado) return [];
      return [...this.itens.values()].map((item) => ({ tipo: "analisador", item }));
    }
    if (no.tipo !== "analisador") return [];

    const { item } = no;
    if (item.achados?.length) {
      return item.achados.map((achado) => ({ tipo: "achado", achado }));
    }
    const saida = this.saidaPara(item);
    return saida ? [saida] : [];
  }

  /** A ação que destrava este analisador, quando existe uma. */
  private saidaPara(e: EstadoDoItem): No | undefined {
    const abrirConfig = (chave: string): vscode.Command => ({
      command: "workbench.action.openSettings",
      title: "",
      arguments: [chave],
    });

    switch (e.razao) {
      case "binary_missing": {
        const bin = e.detalhe ?? "";
        const url = COMO_INSTALAR[bin.toLowerCase()];
        if (!url) return undefined;
        return {
          tipo: "acao",
          rotulo: t("tree.action.installBinary", { bin }),
          icone: "cloud-download",
          comando: {
            command: "vscode.open",
            title: "",
            arguments: [vscode.Uri.parse(url)],
          },
        };
      }
      case "no_workspace":
        return {
          tipo: "acao",
          rotulo: t("tree.action.openFolder"),
          icone: "folder-opened",
          comando: { command: "vscode.openFolder", title: "" },
        };
      case "no_ai_key":
        return {
          tipo: "acao",
          rotulo: t("tree.action.useAccountAi"),
          icone: "sparkle",
          comando: { command: "starguard.enableAccountAi", title: "" },
        };
      case "engine_off":
        return {
          tipo: "acao",
          rotulo: t("tree.action.enable"),
          icone: "gear",
          comando: abrirConfig("starguard.analyzers.enabled"),
        };
      case "no_input":
        // A entrada que falta depende de quem pede: a skill é o arquivo
        // aberto; a modelagem de ameaças e as regras de negócio querem a
        // descrição do sistema.
        return e.id === "skills"
          ? {
              tipo: "acao",
              rotulo: t("tree.action.openSkill"),
              icone: "go-to-file",
              comando: { command: "workbench.action.files.openFile", title: "" },
            }
          : {
              tipo: "acao",
              rotulo: t("tree.action.describeSystem"),
              icone: "edit",
              comando: abrirConfig("starguard.systemDescription"),
            };
      default:
        return undefined;
    }
  }

  getTreeItem(no: No): vscode.TreeItem {
    if (no.tipo === "acao") return this.itemDeAcao(no);
    if (no.tipo === "achado") return this.itemDeAchado(no.achado);
    return this.itemDeAnalisador(no.item);
  }

  private itemDeAnalisador(e: EstadoDoItem): vscode.TreeItem {
    const nome = t(`analyzer.${e.id}.name` as MessageKey);
    const n = e.achados?.length;

    // Um analisador só abre se tiver o que mostrar dentro — nem achado nem
    // saída significa seta de expansão que abre no vazio.
    const temFilhos = !!n || !!this.saidaPara(e);
    const item = new vscode.TreeItem(
      nome,
      temFilhos
        ? n
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    // CURTO: o VS Code trunca a descrição, e "Faltou a entr…" não informa
    // nada. O motivo inteiro fica no tooltip, que não trunca.
    item.description =
      e.estado === "rodando"
        ? t("tree.state.running")
        : e.estado === "erro"
          ? t("tree.state.failed")
          : n
            ? n === 1
              ? t("tree.findings.one")
              : t("tree.findings.many", { n })
            : n === 0
              ? t("tree.state.clean")
              : e.disponivel
                ? undefined
                : t("tree.state.unavailable");

    const md = new vscode.MarkdownString(
      `**${nome}**\n\n${t(`analyzer.${e.id}.desc` as MessageKey)}`
    );
    if (e.motivo) md.appendMarkdown(`\n\n$(circle-slash) ${e.motivo}`);
    md.supportThemeIcons = true;
    item.tooltip = md;

    item.iconPath = this.iconeDoAnalisador(e, n);
    // O `contextValue` é o que habilita o ▶ inline só em quem pode rodar.
    item.contextValue = e.disponivel ? "analyzer-ready" : "analyzer-blocked";
    return item;
  }

  private iconeDoAnalisador(e: EstadoDoItem, n: number | undefined): vscode.ThemeIcon {
    if (e.estado === "rodando") return new vscode.ThemeIcon("loading~spin");
    if (e.estado === "erro") {
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    }
    if (!e.disponivel) return new vscode.ThemeIcon("circle-slash");
    if (n) {
      // A cor vem do achado MAIS GRAVE: a lista já está ordenada por
      // severidade, então o primeiro é o pior.
      const pior = e.achados![0]!.severity;
      return new vscode.ThemeIcon(
        "warning",
        new vscode.ThemeColor(COR_SEV[pior] ?? "charts.orange")
      );
    }
    if (n === 0) {
      return new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("charts.green"));
    }
    return new vscode.ThemeIcon("circle-large-outline");
  }

  private itemDeAchado(a: Achado): vscode.TreeItem {
    const item = new vscode.TreeItem(a.title, vscode.TreeItemCollapsibleState.None);
    item.description = a.line ? `${a.file}:${a.line}` : a.file;

    const md = new vscode.MarkdownString(
      `**${a.title}**\n\n${a.description || ""}`
    );
    md.appendMarkdown(
      `\n\n\`${a.ruleId ?? "—"}\` · ${t(`severity.${a.severity}` as MessageKey)}`
    );
    item.tooltip = md;

    item.iconPath = new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor(COR_SEV[a.severity] ?? "charts.blue")
    );

    // Clicar no achado abre o arquivo NA LINHA. Sem isto o item é decorativo
    // e obriga a passar pelo painel Problemas para chegar ao código.
    const root = raiz();
    if (root && a.file) {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), a.file);
      const linha = Math.max(0, (a.line ?? 1) - 1);
      item.command = {
        command: "vscode.open",
        title: "",
        arguments: [uri, { selection: new vscode.Range(linha, 0, linha, 0) }],
      };
    }
    item.contextValue = "finding";
    return item;
  }

  private itemDeAcao(no: Extract<No, { tipo: "acao" }>): vscode.TreeItem {
    const item = new vscode.TreeItem(no.rotulo, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(no.icone);
    item.command = no.comando;
    item.contextValue = "action";
    return item;
  }
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
  arvore = new ArvoreDeAnalisadores();

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

  painel = vscode.window.createTreeView("starguard.analyzers", {
    treeDataProvider: arvore,
    showCollapseAll: true,
  });

  ctx.subscriptions.push(
    saida,
    ...colecoes.values(),
    painel,
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

    // O ▶ inline entrega o NÓ da árvore, não o estado cru: desde que os
    // achados viraram filhos, nem todo nó é um analisador.
    vscode.commands.registerCommand("starguard.runOne", async (no: No) => {
      if (no?.tipo === "analisador") await analisar([no.item.id]);
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
      arvore.limpar();
      atualizarSelo();
    }),

    // A saída oferecida no analisador bloqueado por falta de IA. É o mesmo
    // consentimento de sempre — só que pedido no momento em que a pessoa
    // demonstrou querer aquele analisador, e não no meio de uma análise.
    vscode.commands.registerCommand("starguard.enableAccountAi", async () => {
      if (!(await exigirConta(true))) return;
      await configurarIa(ctxGlobal);
      await arvore.recarregar();
    }),

    vscode.commands.registerCommand("starguard.requestAccess", async () => {
      // Quem instalou da Marketplace sem conta precisa de uma saída que não
      // seja a aba de avaliações.
      await vscode.env.openExternal(vscode.Uri.parse(urlDeAcesso()));
    }),

    vscode.commands.registerCommand("starguard.signIn", async () => {
      const s = await exigirConta(true);
      if (s) {
        void vscode.window.showInformationMessage(
          `StarGuard: conectado como ${s.account.label}.`
        );
        await arvore.recarregar();
      }
    }),

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
      if (e.affectsConfiguration("starguard")) void arvore.recarregar();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => void arvore.recarregar())
  );

  // O estado do portão é resolvido na ativação e a cada mudança de sessão —
  // inclusive quando o refresh é recusado porque alguém revogou o dispositivo
  // no painel. Sem isto, a árvore continuaria oferecendo ▶ para uma sessão que
  // já não existe.
  ctx.subscriptions.push(
    vscode.authentication.onDidChangeSessions(async (e) => {
      if (e.provider.id !== "starguard") return;
      await exigirConta();
      await arvore.recarregar();
    })
  );

  await exigirConta();
  await arvore.recarregar();
}

export function deactivate(): void {
  for (const c of colecoes?.values() ?? []) c.dispose();
}
