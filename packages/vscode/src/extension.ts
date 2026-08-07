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
import { ANALYZER_IDS, type AnalyzerId, type ThreatModel } from "@starguard/core/types";
import type {
  AnalysisRun,
  ExecutionPlan,
  FileChange,
  FixProposal,
  FixableFinding,
  PlanEntry,
  Workspace,
} from "@starguard/core/contracts";
import { achadosDe, chaveDoAchado, ehDiagnostico, type Achado } from "./findings.js";
import { groupByFile, proposeForFile } from "@starguard/core/fix/batch";
import { normPath } from "@starguard/core/dedup";
import { StarGuardAuthProvider, definirLog, pedirLogin, sessaoAtual } from "./auth.js";
import { setAiTransport } from "@starguard/core/ai-transport";
import { setScanTransport } from "@starguard/core/scan-transport";
import { cfg, servidor, urlDeAcesso } from "./config.js";
import { checkServerReadiness } from "./server-readiness.js";
import { usingRemoteScan } from "@starguard/core/scan-transport";
import {
  PainelStarGuard,
  type ArquivoDeSkill,
  type CartaoDeAnalisador,
  type CorrecaoNaTela,
  type GanchosDoPainel,
  type PrNaTela,
  type ProgressoNaTela,
  type ResultadoNaTela,
} from "./painel.js";
import {
  acrescentar,
  fonteDeSkills,
  nomeDe,
  type DocumentoAberto,
} from "./skills.js";
import type { TextosDoPainel } from "./painel-html.js";

let saida: vscode.OutputChannel;
let colecoes: Map<AnalyzerId, vscode.DiagnosticCollection>;
let painel: PainelStarGuard;
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
  const regras = cfg().get<string>("sastRules")?.trim();

  // APAGAR quando a configuração está vazia, e não só gravar quando tem valor.
  //
  // `process.env` do extension host vive enquanto o editor viver: sem isto,
  // limpar o campo na tela de configurações não desfazia nada — o caminho
  // velho continuava valendo até reiniciar o VS Code, e quem apontou um
  // binário errado não tinha como voltar atrás sem fechar o editor.
  const definir = (nome: string, valor?: string) => {
    if (valor) process.env[nome] = valor;
    else delete process.env[nome];
  };

  definir("SEMGREP_BIN", semgrep);
  definir("OPENGREP_BIN", semgrep);
  definir("TRIVY_BIN", trivy);
  // Sem regras locais, o Opengrep usa "auto" e BAIXA o ruleset de semgrep.dev.
  // Numa máquina sem saída para a internet — ou atrás de proxy com CA própria —
  // isso falha no meio da análise, e o sintoma é um erro de rede no lugar de
  // "falta configurar". Quem já tem as regras no disco aponta aqui.
  definir("SAST_RULES", regras);
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

/**
 * Pede login apenas quando o servidor tem condições de concluí-lo.
 *
 * O health público responde em até oito segundos mesmo com o Postgres
 * pendurado. Sem esta sonda, o OAuth abre o navegador e espera minutos por um
 * retorno impossível; o relato inevitável é "a análise nunca termina", embora
 * nenhum analisador tenha sido iniciado.
 */
async function pedirContaComServidorPronto(): Promise<vscode.AuthenticationSession | undefined> {
  const atual = await exigirConta();
  if (atual) return atual;

  const pronto = await checkServerReadiness(servidor());
  if (!pronto.ok) {
    const mensagem = t(pronto.errorKey ?? "err.network");
    saida.appendLine(
      `[server] ${mensagem}${pronto.detail ? ` · ${pronto.detail}` : ""}`
    );
    void vscode.window.showErrorMessage(mensagem);
    return undefined;
  }
  return exigirConta(true);
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

// A chave mora em `findings.ts`, que é puro e tem teste. Aqui só o apelido —
// `Achado` e `FixableFinding` satisfazem os dois o mesmo parâmetro estrutural,
// e é isso que garante que a correção reencontre o que corrigiu.
const chaveDe = chaveDoAchado;
const chaveDoFinding = chaveDoAchado;

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
  // Clique duplo no botão não dispara duas execuções sobre o mesmo diretório.
  if (rodando) return;

  // `true`: quem clicou em analisar está pedindo para usar a ferramenta, então
  // abrir o login é a resposta esperada — não uma interrupção.
  if (!(await pedirContaComServidorPronto())) return;

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
  const skills = await entradaDeSkills(select);

  const execPlan = await montarPlano({
    select,
    source: { type: "local", path: root },
    locale: locale(),
    systemDescription: descricao,
    skills,
  });

  ultimoPlano = execPlan;
  // Só o estado dos cartões DESTA execução é zerado. Quem não foi selecionado
  // mantém o ✔ e a contagem da execução anterior — que é o que a lista abaixo
  // continua mostrando.
  for (const id of select) estadoDosCartoes.delete(id);
  for (const e of execPlan.entries) {
    if (!e.willRun && e.reason !== "not_selected") {
      estadoDosCartoes.set(e.id, { estado: "pulado" });
    }
  }

  // `rodando = true` entra DENTRO do try, e não antes dele.
  //
  // Estava fora, com dois `await` entre a atribuição e o `try`. Qualquer um dos
  // dois falhando deixava `rodando` preso em `true` — e a partir daí todo
  // clique em Analisar caía no `if (rodando) return` lá em cima e não fazia
  // nada, com o botão parado em "Analisando…" até recarregar a janela. O
  // `finally` já existia e estava certo; ele só não cobria o trecho onde o erro
  // acontecia. Ver AUDITORIA.md#UX-24.
  try {
    rodando = true;
    abortarAnalise = new AbortController();
    // A barra é DETERMINADA: o plano sabe quantos vão rodar antes de o
    // primeiro começar. Uma listra indeterminada num trabalho que passa de um
    // minuto só prova que o processo não morreu — não informa nada.
    progressoDaAnalise = {
      total: execPlan.entries.filter((e) => e.willRun).length,
      feitos: 0,
      desde: Date.now(),
    };
    await painel.atualizar({ erro: null });
    relatarPulados(execPlan);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "StarGuard",
        // Cancelar precisa existir nos dois lugares: quem está com o painel
        // fechado só vê a notificação. Ambos puxam o mesmo controlador.
        cancellable: true,
      },
      async (progresso, token) => {
        token.onCancellationRequested(() => abortarAnalise?.abort());

        // O workspace é aberto AQUI e passado ao orquestrador: entre uma
        // execução e outra o diretório é o mesmo, e reabri-lo a cada clique
        // seria desperdício.
        const ws = await openWorkspace({ type: "local", path: root });
        try {
          const run = await executar(execPlan, {
            workspace: ws,
            systemDescription: descricao,
            skills,
            signal: abortarAnalise!.signal,
            sinks: [
              {
                on: (e) => {
                  if (e.type === "analyzer:start") {
                    const nome = t(`analyzer.${e.id}.name` as MessageKey);
                    if (progressoDaAnalise) {
                      progressoDaAnalise.atual = nome;
                      progressoDaAnalise.detalhe = undefined;
                    }
                    // A notificação ganha o mesmo "3 de 5" da barra: quem está
                    // com o painel fechado só vê ela.
                    progresso.report({ message: rotuloDoProgresso(nome) });
                    estadoDosCartoes.set(e.id, { estado: "rodando" });
                    painel.progresso(e.id, "rodando");
                    void painel.atualizar();
                  }
                  // O analisador conta o que está fazendo ("baixando regras",
                  // o modelo escolhido). Ficava só no objeto de evento; agora
                  // vira o subtítulo do cartão, no lugar da descrição fixa.
                  if (e.type === "analyzer:progress") {
                    const atual = estadoDosCartoes.get(e.id) ?? { estado: "rodando" as const };
                    estadoDosCartoes.set(e.id, { ...atual, detalhe: e.message });
                    painel.progresso(e.id, "rodando", { detalhe: e.message });
                    if (progressoDaAnalise) {
                      progressoDaAnalise.detalhe = e.message;
                      void painel.atualizar();
                    }
                  }
                  if (e.type === "analyzer:done" || e.type === "analyzer:error") {
                    const estado = e.type === "analyzer:done" ? "pronto" : "erro";
                    estadoDosCartoes.set(e.id, { estado });
                    painel.progresso(e.id, estado);
                    // Terminou é terminou, com QUALQUER desfecho: uma barra que
                    // só conta sucesso trava em 60% quando um analisador falha.
                    if (progressoDaAnalise) {
                      progressoDaAnalise.feitos += 1;
                      progressoDaAnalise.atual = undefined;
                      progressoDaAnalise.detalhe = undefined;
                      progresso.report({
                        increment: 100 / Math.max(1, progressoDaAnalise.total),
                      });
                      void painel.atualizar();
                    }
                  }
                  // `not_selected` não é "pulado": ninguém pediu. Marcar o
                  // cartão faria a tela dizer que algo deu errado com um
                  // analisador que a pessoa deliberadamente deixou de fora.
                  if (e.type === "analyzer:skipped" && e.reason !== "not_selected") {
                    estadoDosCartoes.set(e.id, { estado: "pulado" });
                    painel.progresso(e.id, "pulado");
                  }
                },
              },
            ],
          });
          aplicarResultado(run, root, select);
          if (abortarAnalise?.signal.aborted) {
            void vscode.window.showInformationMessage(t("panel.cancelled"));
          }
        } finally {
          await ws?.dispose();
        }
      }
    );
  } catch (e) {
    // Falha ANTES ou FORA dos analisadores (o clone, o workspace): o
    // orquestrador já isola o erro de cada um, então o que chega aqui não tem
    // dono e sumia em silêncio, com o botão girando.
    const msg = e instanceof Error ? e.message : String(e);
    saida.appendLine(`[run] ${msg}`);
    await painel.atualizar({ erro: msg });
    void vscode.window.showErrorMessage(`StarGuard · ${msg.split("\n")[0]}`);
  } finally {
    // O ÚNICO lugar que desliga o botão, e ele roda em toda saída — inclusive
    // na que lança. Ver AUDITORIA.md#UX-24.
    rodando = false;
    abortarAnalise = undefined;
    // O mesmo `finally` que desliga o botão desliga a barra: são o mesmo fato.
    progressoDaAnalise = null;
    await painel.atualizar();
  }
}

// ------------------------------------------------------------
// A entrada do analisador de skills — AUDITORIA.md#UX-23
// ------------------------------------------------------------

/** Chave dos arquivos escolhidos, no estado do WORKSPACE. */
const SKILLS_ESCOLHIDAS = "starguard.skillsEscolhidas";

/**
 * Arquivos apontados a dedo no painel. Ficam no estado do workspace porque são
 * do projeto, não da máquina: quem abre outro repositório não herda a escolha
 * feita no anterior.
 */
let skillsEscolhidas: string[] = [];

function documentoAtivo(): DocumentoAberto | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) return undefined;
  return { esquema: doc.uri.scheme, caminho: doc.uri.fsPath, semTitulo: doc.isUntitled };
}

/** O que a lista do painel mostra — e o sinal de que HÁ entrada para o plano. */
function arquivosDeSkill(): ArquivoDeSkill[] {
  const fonte = fonteDeSkills({ escolhidos: skillsEscolhidas, aberto: documentoAtivo() });
  if (fonte.tipo === "escolhidos") {
    return fonte.caminhos.map((c) => ({ caminho: c, nome: nomeDe(c), doEditor: false }));
  }
  if (fonte.tipo === "editor") {
    return [{ caminho: fonte.caminho, nome: nomeDe(fonte.caminho), doEditor: true }];
  }
  return [];
}

/**
 * Quando `skills` está no plano, o que vale é o que a pessoa escolheu no
 * painel — e, se ela não escolheu nada, o arquivo aberto no editor.
 *
 * O atalho do editor continua sendo o caminho natural de quem está escrevendo
 * um prompt e quer validar aquele prompt. O que ele não podia continuar sendo
 * é a ÚNICA entrada: um `prompts.md` que não estivesse aberto não tinha por
 * onde entrar, e o cartão apagava com "sem entrada" sem oferecer saída.
 *
 * O conteúdo do editor sai de `getText()`, não do disco: o que está na tela,
 * ainda não salvo, é justamente o que se quer validar. Os escolhidos vêm do
 * disco, que é a versão que os outros vão ler.
 */
async function entradaDeSkills(
  select: AnalyzerId[]
): Promise<{ name: string; content: string }[] | undefined> {
  if (!select.includes("skills")) return undefined;

  const doc = vscode.window.activeTextEditor?.document;
  const fonte = fonteDeSkills({ escolhidos: skillsEscolhidas, aberto: documentoAtivo() });

  if (fonte.tipo === "nenhuma") return undefined;
  if (fonte.tipo === "editor") {
    return doc ? [{ name: nomeDe(doc.uri.fsPath), content: doc.getText() }] : undefined;
  }

  const lidos: { name: string; content: string }[] = [];
  for (const caminho of fonte.caminhos) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(caminho));
      lidos.push({ name: nomeDe(caminho), content: new TextDecoder().decode(bytes) });
    } catch {
      // Arquivo apagado ou renomeado depois de escolhido. Avisa e segue com os
      // outros: perder a análise inteira por causa de um caminho velho seria
      // pior que analisar o que ainda existe.
      saida.appendLine(`[skills] ${t("panel.skillsUnreadable", { file: caminho })}`);
      void vscode.window.showWarningMessage(
        t("panel.skillsUnreadable", { file: nomeDe(caminho) })
      );
    }
  }
  return lidos.length ? lidos : undefined;
}

function aplicarResultado(run: AnalysisRun, root: string, select: AnalyzerId[]): void {
  const achados = achadosDe(run);

  // Só as coleções dos analisadores que RODARAM são reescritas. Rodar o Trivy
  // não pode apagar os achados do Semgrep da execução anterior.
  for (const id of select) {
    const o = run.outcomes[id];
    if (!o || o.status === "skipped") continue;
    // `ehDiagnostico` filtra o que não tem posição confiável no projeto — as
    // skills entram na LISTA do painel, não no sublinhado do editor.
    publicar(id, achados.filter((a) => a.analyzer === id && ehDiagnostico(a)), root);
  }

  const rodaram = select.filter((id) => {
    const o = run.outcomes[id];
    return !!o && o.status !== "skipped";
  });

  // A LISTA do painel segue a mesma regra das coleções de diagnóstico: só o
  // que rodou é substituído.
  //
  // Antes o painel era remontado apenas com os analisadores da execução atual.
  // Rodar só o SAST depois de uma análise completa apagava as dependências da
  // tela — enquanto o painel Problemas continuava mostrando as duas coisas. A
  // mesma extensão dizia duas verdades diferentes sobre o mesmo projeto, e a
  // independência que o cabeçalho deste arquivo promete valia só para metade
  // dela.
  for (const id of rodaram) {
    achadosPorAnalisador.set(id, achados.filter((a) => a.analyzer === id));
    avisosPorAnalisador.set(
      id,
      (run.outcomes[id]?.degraded ?? []).map((d) => t(`analyzer.degraded.${d}` as MessageKey))
    );
  }
  if (rodaram.includes("threat")) {
    const modelo = run.outcomes.threat?.status === "done"
      ? (run.outcomes.threat.result as ThreatModel | undefined)
      : undefined;
    requisitosGuardados = (modelo?.requirements ?? []).map((r) => ({
      id: r.id,
      texto: r.text,
    }));
  }

  // A contagem do cartão sai do que a LISTA mostra: qualquer outra conta faria
  // o cartão dizer 3 e o grupo abaixo dele mostrar 2.
  for (const id of rodaram) {
    const atual = estadoDosCartoes.get(id);
    if (!atual || atual.estado === "erro") continue;
    // A modelagem de ameaças não produz achado: contá-la daria peso de
    // problema a uma lista de requisitos, que é o erro do UX-22.
    if (id === "threat") continue;
    estadoDosCartoes.set(id, {
      estado: atual.estado,
      achados: achados.filter((a) => a.analyzer === id).length,
    });
  }

  ultimoResultado = montarResultado();
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

/** "Vulnerabilidades de código · 2 de 5" — a notificação diz o mesmo que a barra. */
function rotuloDoProgresso(nome: string): string {
  const p = progressoDaAnalise;
  if (!p?.total) return nome;
  return `${nome} · ${t("panel.progress", { feitos: p.feitos + 1, total: p.total })}`;
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

  // O `try` começa ANTES de abrir o workspace, não depois de propor.
  //
  // Estava depois: `openWorkspace` e `propose` rodavam fora dele, e uma falha
  // em qualquer um dos dois escapava sem passar pelo `finally` — o workspace
  // ficava aberto e a exceção subia para o registrador do comando, onde o VS
  // Code a transforma em nada visível. Quem clicou na lâmpada via o progresso
  // sumir e mais nada acontecer.
  try {
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

    if (proposta.noChange) {
      void vscode.window.showWarningMessage(t("fix.noChange"));
      return;
    }

    // O diff ANTES de escrever. `propose` não tocou em disco, então mostrar e
    // desistir não deixa rastro — é o que separa "revisei e aceitei" de "a
    // ferramenta mexeu no meu código".
    const principal = proposta.changes[0]!;
    await mostrarDiff(principal);

    // Uma proposta pode tocar mais de um arquivo, e o diff mostra só o
    // primeiro. Aplicar sem dizer isso grava arquivo que ninguém revisou —
    // o oposto do que a confirmação existe para garantir.
    const extras = proposta.changes.length - 1;
    const explicacao = extras > 0
      ? `${proposta.explanation}\n\n${t("panel.fixAlsoFiles", { n: extras })}`
      : proposta.explanation;

    const escolha = await vscode.window.showInformationMessage(
      explicacao,
      { modal: false },
      t("fix.apply"),
      t("common.cancel")
    );
    if (escolha !== t("fix.apply")) return;

    await fixer.apply(proposta, ws!);
    void vscode.window.showInformationMessage(t("fix.applied"));
    // O achado corrigido sai da lista e do painel Problemas. Deixá-lo ali
    // oferecendo "Corrigir" de novo faria a segunda correção partir do arquivo
    // já reescrito e desfazer a primeira — o BUG-06 pela porta da lâmpada.
    retirarAchados([chave]);

    for (const seg of proposta.followUp ?? []) {
      // O aviso do lockfile precisa aparecer: a correção edita o manifesto e
      // NÃO regera o lock.
      void vscode.window.showWarningMessage(
        t(seg.commandKey, { cmd: seg.command ?? "", manifest: principal.file, lockfile: "" })
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    saida.appendLine(`[fix] ${achado.file}: ${msg}`);
    void vscode.window.showErrorMessage(`StarGuard · ${msg.split("\n")[0]}`);
  } finally {
    await ws?.dispose();
  }
}

/**
 * Tira da tela e do painel Problemas os achados que acabaram de ser corrigidos.
 *
 * Não é cosmético: um achado corrigido que continua na lista continua marcável,
 * e a próxima correção partiria de um arquivo que já mudou — a segunda gravação
 * desfaz a primeira, com a tela dizendo que as duas foram aplicadas. É o BUG-06
 * outra vez, agora entre RODADAS em vez de dentro de uma.
 *
 * Some da lista, não do disco: quem quiser conferir roda a análise de novo, e
 * a mensagem de "aplicado" já diz isso.
 */
function retirarAchados(chaves: string[]): void {
  const fora = new Set(chaves);
  if (!fora.size) return;

  let saiu = 0;
  for (const [id, lista] of achadosPorAnalisador) {
    const restam = lista.filter((a) => !fora.has(chaveDe(a)));
    saiu += lista.length - restam.length;
    achadosPorAnalisador.set(id, restam);
    // O cartão conta o que a lista mostra. Sem isto ele continuaria dizendo 7
    // com seis linhas embaixo.
    const cartao = estadoDosCartoes.get(id);
    if (cartao && id !== "threat") {
      estadoDosCartoes.set(id, { ...cartao, achados: restam.length });
    }
  }
  for (const k of fora) achadosPorChave.delete(k);
  if (!saiu) return;

  republicarDiagnosticos();
  ultimoResultado = montarResultado();
  void painel.atualizar({ resultado: ultimoResultado });
  // A partir de dois, e não sempre: numa correção pela lâmpada a linha some
  // exatamente onde a pessoa clicou, e um aviso a mais em cima do "correção
  // aplicada" seriam duas notificações para uma ação só. Num lote de doze, a
  // frase é a única explicação de por que a lista encolheu.
  if (saiu > 1) void vscode.window.showInformationMessage(t("panel.fixCleared", { n: saiu }));
}

/** Reescreve as coleções a partir do que sobrou — o editor precisa concordar. */
function republicarDiagnosticos(): void {
  const root = raiz();
  if (!root) return;
  for (const [id, lista] of achadosPorAnalisador) {
    publicar(id, lista.filter(ehDiagnostico), root);
  }
}

/** Conteúdo virtual do diff — nada disto existe em disco. */
class ProvedorDeDiff implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return Buffer.from(uri.query, "base64").toString("utf8");
  }
}

async function mostrarDiff(mudanca: FileChange): Promise<void> {
  const antes = vscode.Uri.parse(
    `starguard-diff:${encodeURIComponent(mudanca.file)}?${Buffer.from(
      mudanca.originalCode
    ).toString("base64")}`
  );
  const depois = vscode.Uri.parse(
    `starguard-diff:${encodeURIComponent(mudanca.file)} (StarGuard)?${Buffer.from(
      mudanca.fixedCode
    ).toString("base64")}`
  );
  await vscode.commands.executeCommand(
    "vscode.diff",
    antes,
    depois,
    `${mudanca.file} — StarGuard`
  );
}

// ------------------------------------------------------------
// Correção em LOTE — AUDITORIA.md#UX-24
// ------------------------------------------------------------

interface PropostaGuardada {
  chave: string;
  arquivo: string;
  achados: number;
  /** Os achados que esta proposta cobre — saem da lista quando ela é aplicada. */
  chavesDeAchado: string[];
  /** De quem é o corretor. Guardado, e não deduzido do caminho na hora. */
  analyzer: AnalyzerId;
  estado: CorrecaoNaTela["estado"];
  proposta?: FixProposal;
  erro?: string;
}

/** As propostas da rodada atual, por arquivo. Nada aqui foi gravado em disco. */
const propostas = new Map<string, PropostaGuardada>();
let abortarCorrecao: AbortController | undefined;
/** O PR da rodada. Um só, com tudo o que estiver pronto. */
let prNaTela: PrNaTela = { abrindo: false };

function correcoesNaTela(): CorrecaoNaTela[] {
  return [...propostas.values()].map((p) => ({
    chave: p.chave,
    arquivo: p.arquivo,
    achados: p.achados,
    extras: Math.max(0, (p.proposta?.changes.length ?? 1) - 1),
    estado: p.estado,
    erro: p.erro,
  }));
}

/**
 * Gera UMA correção por arquivo para os achados marcados.
 *
 * O agrupamento é a razão de existir deste caminho, e ele já custou um bug ao
 * painel (BUG-06): uma correção por achado faria cada uma partir do arquivo
 * original e a última gravada apagaria as anteriores — com a tela dizendo que
 * todas foram aplicadas. A aritmética mora no núcleo (`fix/batch.ts`), a mesma
 * que o navegador usa.
 *
 * A chave do grupo carrega o CORRETOR junto do caminho: dependência e código
 * têm corretores diferentes, e mandar um achado de CVE para o corretor de
 * código produziria uma reescrita sem sentido. Na prática são arquivos
 * distintos (manifesto x fonte); a chave é a garantia de que continuam sendo.
 */
async function corrigirLote(chaves: string[]): Promise<void> {
  const root = raiz();
  if (!root) return;

  // `paraFinding` preserva o `raw`, que é o payload que o corretor de cada
  // analisador sabe ler — e o `analyzer`, que diz de quem é o corretor.
  const alvos = chaves
    .map((k) => achadosPorChave.get(k))
    .filter((a): a is Achado => !!a)
    .map(paraFinding)
    .filter((f) => getAnalyzer(f.analyzer)?.fix?.can(f).ok);

  if (!alvos.length) {
    void vscode.window.showWarningMessage(t("panel.fixNoneFixable"));
    return;
  }

  // Um grupo por (corretor, arquivo). Dependência e código têm corretores
  // diferentes: mandar um CVE para o corretor de código produziria uma
  // reescrita sem sentido. Na prática são arquivos distintos (manifesto x
  // fonte) — a chave é a garantia de que continuam sendo.
  const familia = (f: FixableFinding) => (f.analyzer === "sca" ? "deps" : "code");
  const porFamilia = new Map<string, FixableFinding[]>();
  for (const f of alvos) {
    const k = familia(f);
    porFamilia.set(k, [...(porFamilia.get(k) ?? []), f]);
  }

  const grupos: { chave: string; arquivo: string; achados: FixableFinding[] }[] = [];
  for (const [fam, lista] of porFamilia) {
    for (const g of groupByFile(lista)) {
      grupos.push({
        chave: `${fam}|${normPath(g.file)}`,
        arquivo: g.file,
        achados: g.findings,
      });
    }
  }

  aplicarConfiguracao();
  abortarCorrecao = new AbortController();
  propostas.clear();
  prNaTela = { abrindo: false };
  for (const g of grupos) {
    propostas.set(g.chave, {
      chave: g.chave,
      arquivo: g.arquivo,
      achados: g.achados.length,
      // As chaves dos achados que esta proposta cobre. Guardadas porque, depois
      // de aplicar, são exatamente as linhas que precisam sair da lista.
      chavesDeAchado: g.achados.map((f) => chaveDoFinding(f)),
      analyzer: g.achados[0]!.analyzer,
      estado: "gerando",
    });
  }
  await painel.atualizar();

  // `openWorkspace` DENTRO do try, e as sobras normalizadas no finally.
  //
  // Estava fora: se abrir o workspace falhasse, a função saía com todas as
  // propostas em "gerando…" e o `abortarCorrecao` ainda montado. O bloco de
  // correções ficava com um relógio girando para sempre, sem erro nenhum
  // escrito em lugar nenhum e sem botão que resolvesse. É o mesmo defeito do
  // botão de Analisar, na outra metade da tela.
  let ws: Workspace | undefined;
  try {
    ws = await openWorkspace({ type: "local", path: root });
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("panel.fixes"),
        cancellable: true,
      },
      async (progresso, token) => {
        token.onCancellationRequested(() => abortarCorrecao?.abort());
        let feitas = 0;

        // Sequencial, e não em paralelo: cada proposta é uma chamada de IA
        // paga, e três gerando ao mesmo tempo tornam o cancelamento uma
        // promessa que a extensão não cumpre. O painel web paraleliza porque
        // lá o trabalho é do servidor; aqui é da máquina de quem clicou.
        for (const g of grupos) {
          if (abortarCorrecao?.signal.aborted) {
            const p = propostas.get(g.chave)!;
            p.estado = "cancelada";
            continue;
          }
          progresso.report({
            message: `${g.arquivo} (${++feitas}/${grupos.length})`,
            increment: 100 / grupos.length,
          });

          const fixer = getAnalyzer(g.achados[0]!.analyzer)!.fix!;
          const guardada = propostas.get(g.chave)!;
          try {
            const proposta = await proposeForFile(
              fixer,
              { file: g.arquivo, findings: g.achados },
              {
                workspace: ws!,
                locale: locale(),
                repoUrl: ws?.origin?.url,
                signal: abortarCorrecao?.signal,
              }
            );
            guardada.proposta = proposta;
            guardada.estado = proposta.noChange ? "semMudanca" : "pronta";
          } catch (e) {
            // Uma falha não derruba o lote: é a mesma regra do orquestrador.
            guardada.estado = "erro";
            guardada.erro = (e instanceof Error ? e.message : String(e)).split("\n")[0];
            saida.appendLine(`[fix] ${g.arquivo}: ${guardada.erro}`);
          }
          await painel.atualizar();
        }
      }
    );
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
    saida.appendLine(`[fix] ${msg}`);
    void vscode.window.showErrorMessage(`StarGuard · ${msg}`);
  } finally {
    abortarCorrecao = undefined;
    await ws?.dispose();
    // NENHUMA proposta pode sobrar em "gerando…".
    //
    // Esse estado significa "estou trabalhando nisso", e ninguém está mais.
    // Quando o laço morre no meio — erro fora do `try` de dentro, cancelamento,
    // workspace que não abriu — o que resta vira relógio eterno. Aqui a sobra
    // vira "cancelada", que é o que de fato aconteceu com ela.
    for (const p of propostas.values()) {
      if (p.estado === "gerando") p.estado = "cancelada";
    }
    await painel.atualizar();
  }
}

/** Grava uma proposta. Devolve quantos arquivos foram escritos. */
async function aplicarProposta(guardada: PropostaGuardada, ws: Workspace): Promise<number> {
  const proposta = guardada.proposta;
  if (!proposta || guardada.estado !== "pronta") return 0;

  // O corretor é o do analisador que ACHOU o problema — contrato do núcleo.
  const fixer = getAnalyzer(guardada.analyzer)?.fix;
  if (!fixer) return 0;
  await fixer.apply(proposta, ws);
  guardada.estado = "aplicada";

  for (const seg of proposta.followUp ?? []) {
    // O aviso do lockfile precisa aparecer: a correção edita o manifesto e NÃO
    // regera o lock.
    void vscode.window.showWarningMessage(
      t(seg.commandKey, { cmd: seg.command ?? "", manifest: guardada.arquivo, lockfile: "" })
    );
  }
  return proposta.changes.filter((c: FileChange) => c.fixedCode !== c.originalCode).length;
}

async function aplicarCorrecoes(chaves: string[]): Promise<void> {
  const root = raiz();
  if (!root) return;

  let ws: Workspace | undefined;
  const corrigidos: string[] = [];
  try {
    ws = await openWorkspace({ type: "local", path: root });
    if (!ws) return;
    const escritos = new Set<string>();
    let total = 0;
    for (const k of chaves) {
      const g = propostas.get(k);
      if (!g?.proposta) continue;

      // Duas propostas para o MESMO arquivo (só acontece se um manifesto
      // tiver achado de código e de dependência): a segunda partiria do
      // conteúdo antigo e apagaria a primeira. Recusar é o certo — é o BUG-06
      // outra vez, e gravar em silêncio seria pior que não gravar.
      const conflito = g.proposta.changes.some((c: FileChange) =>
        escritos.has(normPath(c.file))
      );
      if (conflito) {
        g.estado = "erro";
        // Era `fix.cannot.noFile` — "arquivo não encontrado". O arquivo existe;
        // o que houve foi outra proposta ter chegado primeiro. Motivo errado na
        // tela manda a pessoa procurar um problema que não é o dela.
        g.erro = t("panel.fixConflict");
        continue;
      }
      total += await aplicarProposta(g, ws);
      if (g.estado === "aplicada") corrigidos.push(...g.chavesDeAchado);
      for (const c of g.proposta.changes) escritos.add(normPath(c.file));
    }
    if (total) void vscode.window.showInformationMessage(t("panel.fixApplied", { n: total }));
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
    saida.appendLine(`[fix] ${msg}`);
    void vscode.window.showErrorMessage(`StarGuard · ${msg}`);
  } finally {
    await ws?.dispose();
    // Os achados gravados saem da lista. A proposta CONTINUA no bloco de
    // correções, marcada como aplicada: é dela que o Pull Request sai depois.
    retirarAchados(corrigidos);
    await painel.atualizar();
  }
}

// ------------------------------------------------------------
// Pull Request — um só, com tudo o que a rodada produziu
// ------------------------------------------------------------

/**
 * Abre UM Pull Request com todas as correções prontas ou já aplicadas.
 *
 * Um e não um por achado: quem recebe cinco PRs do robô no mesmo dia fecha os
 * cinco sem ler. A consolidação por arquivo já aconteceu na geração
 * (`groupByFile`), e `openPullRequestBatch` ainda deduplica por caminho — se o
 * mesmo arquivo aparecer duas vezes, o último conteúdo vence, e ele é o que já
 * acumula a correção anterior.
 *
 * O token vem do provedor de GitHub DO EDITOR, não de configuração nossa. Quem
 * usa VS Code já está autenticado no GitHub para push e para o Copilot; pedir
 * um Personal Access Token à parte seria inventar um segredo a mais para
 * guardar, e guardar segredo é justamente o que esta extensão evita fazer.
 *
 * `createIfNone: true` porque abrir PR É a hora de pedir a autorização: quem
 * clicou está pedindo para escrever no repositório.
 */
async function abrirPr(): Promise<void> {
  if (prNaTela.abrindo) return;

  const levaveis = [...propostas.values()].filter(
    (p) => (p.estado === "pronta" || p.estado === "aplicada") && p.proposta
  );
  if (!levaveis.length) {
    void vscode.window.showWarningMessage(t("panel.prNothing"));
    return;
  }

  const root = raiz();
  if (!root) return;

  let ws: Workspace | undefined;
  prNaTela = { abrindo: true };
  await painel.atualizar();

  try {
    ws = await openWorkspace({ type: "local", path: root });
    const repoUrl = ws?.origin?.url;
    if (!repoUrl) {
      // Sem `origin` no GitHub não há para onde mandar. Dito com todas as
      // letras, e não como falha genérica de rede lá na frente.
      prNaTela = { abrindo: false, erro: t("panel.prNoRepo") };
      return;
    }

    const sessao = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: true,
    });
    if (!sessao) {
      prNaTela = { abrindo: false, erro: t("panel.prNoToken") };
      return;
    }

    // Um conteúdo por arquivo. A ordem preserva a última versão, que é a que
    // acumula as correções anteriores do mesmo arquivo.
    const porArquivo = new Map<string, string>();
    const explicacoes: string[] = [];
    for (const p of levaveis) {
      for (const c of p.proposta!.changes) {
        if (c.fixedCode === c.originalCode) continue;
        porArquivo.set(normPath(c.file), c.fixedCode);
      }
      explicacoes.push(`- **${p.arquivo}** — ${p.proposta!.explanation}`);
    }
    if (!porArquivo.size) {
      prNaTela = { abrindo: false, erro: t("panel.prNothing") };
      return;
    }

    const { openPullRequestBatch } = await import("@starguard/core/git");
    const pr = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t("panel.prOpening") },
      () =>
        openPullRequestBatch({
          repoUrl,
          files: [...porArquivo.entries()].map(([file, fixedCode]) => ({ file, fixedCode })),
          title: `fix(security): ${porArquivo.size} arquivo(s) corrigido(s) pelo StarGuard`,
          body: [
            t("panel.prBody"),
            "",
            ...explicacoes,
            "",
            `> ${t("panel.prReview")}`,
            `> ${t("panel.prBase")}`,
          ].join("\n"),
          token: sessao.accessToken,
        })
    );

    prNaTela = { abrindo: false, numero: pr.number, url: pr.url };
    saida.appendLine(`[pr] #${pr.number} ${pr.url}`);

    // A TELA é atualizada AQUI, antes da notificação.
    //
    // `showInformationMessage` com botão só resolve quando alguém clica ou
    // dispensa — e ninguém é obrigado a fazer isso. Deixar o redesenho para o
    // `finally` significava que o painel continuava mostrando "Abrindo…" com o
    // Pull Request já criado no GitHub, até a notificação ser respondida. O
    // sintoma é o mesmo do botão de Analisar preso: estado gravado, tela velha.
    await painel.atualizar();

    const ver = t("panel.prView");
    const escolha = await vscode.window.showInformationMessage(
      t("panel.prOpened", { n: pr.number }),
      ver
    );
    if (escolha === ver) await vscode.env.openExternal(vscode.Uri.parse(pr.url));
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
    saida.appendLine(`[pr] ${msg}`);
    prNaTela = { abrindo: false, erro: t("panel.prFailed", { erro: msg }) };
  } finally {
    await ws?.dispose();
    // O `finally` é o ÚNICO lugar que desliga `abrindo`, pela mesma razão que
    // vale para o botão de Analisar: todo caminho de saída passa por ele.
    if (prNaTela.abrindo) prNaTela = { abrindo: false };
    await painel.atualizar();
  }
}

// ------------------------------------------------------------
// O painel (webview)
// ------------------------------------------------------------

/** Severidade em ordem de gravidade — governa a ordenação e o placar. */
const ORDEM_SEV: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

/** Último plano montado: é dele que saem disponibilidade e motivo. */
let ultimoPlano: ExecutionPlan | undefined;
/** Seleção corrente, preservada entre aberturas do painel. */
let selecao: AnalyzerId[] = [];
/** Último resultado, para o painel redesenhar sem reanalisar. */
let ultimoResultado: ResultadoNaTela | null = null;

/**
 * Achados VIVOS, por analisador — a fonte da lista do painel.
 *
 * Por analisador e não numa lista só porque a substituição é por analisador:
 * é o mesmo contrato das coleções de diagnóstico, e é o que faz "analisar só o
 * SAST" deixar as dependências da execução anterior de pé.
 */
const achadosPorAnalisador = new Map<AnalyzerId, Achado[]>();
/** Frases de degradação, também por analisador, pelo mesmo motivo. */
const avisosPorAnalisador = new Map<AnalyzerId, string[]>();
/** Requisitos da última modelagem que rodou. Sobrevivem a execuções sem ela. */
let requisitosGuardados: { id: string; texto: string }[] = [];

/**
 * Estado de cada cartão durante e depois da execução.
 *
 * Vive AQUI e não só no webview porque o painel é reconstruído do zero a cada
 * `atualizar()` — antes, qualquer atualização de estado apagava o ✔ e a
 * contagem que a execução tinha acabado de escrever.
 */
interface EstadoDoCartao {
  estado: "rodando" | "pronto" | "erro" | "pulado";
  achados?: number;
  detalhe?: string;
}
const estadoDosCartoes = new Map<AnalyzerId, EstadoDoCartao>();

/**
 * Há uma análise em curso?
 *
 * Quem responde é a extensão, e não o webview. O botão ficava girando para
 * sempre porque o último evento de progresso de uma execução dizia
 * `rodando: true` — e não existia evento nenhum dizendo o contrário.
 * Ver AUDITORIA.md#UX-24.
 */
let rodando = false;
/** Cancela a execução em curso — o botão do painel e a notificação. */
let abortarAnalise: AbortController | undefined;

/**
 * Andamento da execução, para a barra do painel.
 *
 * Vive aqui pela MESMA razão de `rodando`: quem sabe quantos analisadores vão
 * rodar e quantos já terminaram é quem conduz a execução, não a página. Ver
 * UX-24.
 */
let progressoDaAnalise: ProgressoNaTela | null = null;

function textosDoPainel(): TextosDoPainel {
  return {
    titulo: t("panel.signInTitle"),
    // Os dois botões do portão vinham de chaves emprestadas de outra tela: o de
    // entrar recebia o TÍTULO ("StarGuard") por causa de uma condicional que
    // nunca foi verdadeira, e o de pedir acesso dizia "Abrir uma pasta…" — que
    // não é nem de longe o que ele faz. Agora cada um tem a sua chave.
    entrar: t("panel.signIn"),
    entrarSub: t("panel.signInSub"),
    solicitar: t("panel.requestAccess"),
    analisadores: t("panel.analyzers"),
    selecionarTudo: t("panel.selectAll"),
    limpar: t("panel.clearSel"),
    analisar: t("panel.run"),
    analisando: t("panel.running"),
    cancelar: t("common.cancel"),
    descreverSistema: t("panel.describeSystem"),
    descricaoAjuda: t("panel.describeHelp"),
    descricaoVazia: t("panel.describeEmpty"),
    skills: t("panel.skills"),
    skillsAjuda: t("panel.skillsHelp"),
    skillsVazio: t("panel.skillsEmpty"),
    skillsAdicionar: t("panel.skillsAdd"),
    skillsRemover: t("panel.skillsRemove"),
    skillsDoEditor: t("panel.skillsFromEditor"),
    resultado: t("panel.result"),
    semAchados: t("panel.noFindings"),
    aindaNaoRodou: t("panel.notRunYet"),
    indisponivel: t("panel.unavailable"),
    pr: t("panel.pr"),
    prHint: t("panel.prHint"),
    prBase: t("panel.prBase"),
    prAbrindo: t("panel.prOpening"),
    prVer: t("panel.prView"),
    prAberto: t("panel.prOpened"),
    progresso: t("panel.progress"),
    progressoAguarde: t("panel.progressWaiting"),
    corrigir: t("panel.fix"),
    diagnostico: t("panel.doctor"),
    sair: t("panel.signOut"),
    nenhumSelecionado: t("panel.nothingSelected"),
    privacidade: t("panel.privacy"),
    marcarTudo: t("panel.selectFindings"),
    desmarcar: t("panel.clearFindings"),
    corrigirSelecionados: t("panel.fixSelected"),
    correcoes: t("panel.fixes"),
    correcoesAjuda: t("panel.fixGroupHint"),
    gerandoCorrecoes: t("panel.fixGenerating"),
    estadoGerando: t("panel.fixState.generating"),
    estadoPronta: t("panel.fixState.ready"),
    estadoAplicada: t("panel.fixState.applied"),
    estadoSemMudanca: t("panel.fixState.noChange"),
    estadoErro: t("panel.fixState.error"),
    estadoCancelada: t("panel.fixState.cancelled"),
    verDiff: t("panel.fixView"),
    aplicar: t("panel.fixApply"),
    aplicarTudo: t("panel.fixApplyAll"),
    descartar: t("panel.fixDiscard"),
    umAchado: t("panel.fixFindings.one"),
    nAchados: t("panel.fixFindings.many"),
    maisArquivos: t("panel.fixAlsoFiles"),
    nadaMarcado: t("panel.fixNothingSelected"),
    filtrarTudo: t("panel.filterAll"),
    filtrarAjuda: t("panel.filterHint"),
    degradado: t("panel.degraded"),
    requisitos: t("panel.requirements"),
    requisitosAjuda: t("panel.requirementsHelp"),
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
    // Sinalizador de presença: o conteúdo de verdade só é lido na execução.
    // O que decide se o cartão acende é haver arquivo ESCOLHIDO ou um arquivo
    // de verdade aberto no editor — canal de saída e diff virtual não contam.
    skills: arquivosDeSkill().length ? [{ name: "presente", content: "x" }] : undefined,
  });
}

/** As quatro perguntas, na mesma ordem para os cinco analisadores. */
const SOBRE = ["purpose", "when", "delivers", "fix"] as const;

/**
 * "Para que serve / quando usar / o que entrega / o que corrige" — uma linha
 * por pergunta, no idioma da pessoa.
 *
 * Texto puro, sem marcação: vira `title` no cartão do painel e `detail` no
 * seletor rápido, e nenhum dos dois interpreta HTML. É o MESMO dicionário que
 * o painel web usa no pop-up — três produtos, uma redação só, e quem corrigir
 * uma frase corrige nos três.
 */
function sobreOAnalisador(id: AnalyzerId): string {
  return SOBRE.map(
    (campo) =>
      `${t(`about.${campo}` as MessageKey)}: ${t(`analyzer.${id}.${campo}` as MessageKey)}`
  ).join("\n");
}

/**
 * Comandos que o painel pode disparar. **Allowlist, não lista de conveniência.**
 *
 * O webview manda o id do comando de volta pela ponte de mensagens, e a ponte
 * é o limite de confiança desta extensão: a página exibe título de regra do
 * Opengrep, nome de pacote do Trivy e texto escrito por um modelo. Aceitar
 * qualquer id daí seria deixar o conteúdo analisado executar comando do editor.
 * Os dois abaixo são os únicos que a tela precisa.
 */
const SAIDAS: { comando: string; chave: MessageKey }[] = [
  { comando: "starguard.enableAccountAi", chave: "panel.actionUseServer" },
  { comando: "starguard.configurarCaminhos", chave: "panel.actionConfigurePaths" },
];

/**
 * As SAÍDAS para um analisador indisponível.
 *
 * Dizer "o executável opengrep não foi encontrado" e parar aí é meio caminho:
 * a pessoa fica sabendo o que houve e não o que fazer. É a mesma exigência do
 * UX-15 levada até o fim — nunca deixar "não dá para procurar" sem dizer como
 * passa a dar.
 *
 * Para o binário faltando são DUAS saídas de verdade, e a ordem importa:
 *
 * 1. **Rodar no servidor da conta.** É a promessa central do produto — "nada
 *    precisa ser instalado" — e resolve com um clique, sem download nenhum.
 *    Só aparece enquanto o transporte remoto está desligado, porque é isso que
 *    ele liga.
 * 2. **Apontar o caminho.** Para quem já tem o binário no disco e prefere que
 *    o código não saia da máquina. Esta era a saída que a mensagem sugeria e
 *    que, até agora, não funcionava: a configuração era lida DEPOIS de o núcleo
 *    já ter congelado o valor. Ver o cabeçalho de `packages/core/src/config.ts`.
 */
function saidasPara(reason?: string): { rotulo: string; comando: string }[] {
  if (reason === "no_ai_key") {
    return [{ rotulo: t("tree.action.useAccountAi"), comando: "starguard.enableAccountAi" }];
  }
  // Faltar REGRA tem a mesma saída de faltar binário — apontar o caminho — mas
  // não a de rodar no servidor: o servidor tem o ruleset dele, e oferecer isso
  // aqui responderia a pergunta errada.
  if (reason === "no_rules") {
    return [{ rotulo: t("panel.actionConfigurePaths"), comando: "starguard.configurarCaminhos" }];
  }
  if (reason !== "binary_missing") return [];
  return SAIDAS.filter(
    (s) => s.comando !== "starguard.enableAccountAi" || !usingRemoteScan()
  ).map((s) => ({ rotulo: t(s.chave), comando: s.comando }));
}

function cartoes(): CartaoDeAnalisador[] {
  return ANALYZER_IDS.map((id) => {
    const e = ultimoPlano?.entries.find((x) => x.id === id);
    // `not_selected` não é indisponibilidade: o plano de sondagem não pediu
    // nada, e cada cartão é selecionável por conta própria.
    const disponivel = !e || e.willRun || e.reason === "not_selected";
    const estado = estadoDosCartoes.get(id);

    // O `uses` do analisador, com a frase do que se perde sem cada vizinho.
    //
    // É a resposta na tela para "as regras de negócio dependem da modelagem de
    // ameaças?": não dependem — o `uses` é enriquecimento e o orquestrador
    // nunca arrasta um analisador para dentro do plano por causa de outro. O
    // que muda sem ele está escrito em `analyzer.degraded.*`, e agora aparece
    // no cartão em vez de só no canal de saída. Ver AUDITORIA.md#UX-25.
    const usa = (getAnalyzer(id)?.uses ?? []).map((u) => ({
      id: u,
      nome: t(`analyzer.${u}.name` as MessageKey),
      aviso: t(`analyzer.degraded.${u}` as MessageKey),
    }));

    return {
      id,
      nome: t(`analyzer.${id}.name` as MessageKey),
      desc: t(`analyzer.${id}.desc` as MessageKey),
      sobre: sobreOAnalisador(id),
      disponivel,
      motivo: e && !disponivel ? descreverMotivo(e) : undefined,
      acoes: disponivel ? undefined : saidasPara(e?.reason),
      estado: estado?.estado,
      achados: estado?.achados,
      detalhe: estado?.detalhe,
      usa: usa.length ? usa : undefined,
    };
  });
}

/**
 * A tela de resultado, montada do que está ACUMULADO — não de uma execução.
 *
 * Recebe zero argumentos de propósito: enquanto ela lia um `AnalysisRun`, o
 * painel só sabia falar da última execução, e "analisar só o SAST" apagava
 * tudo o mais. A fonte agora é `achadosPorAnalisador`, que cada execução
 * atualiza APENAS nas chaves que rodaram — exatamente como as coleções de
 * diagnóstico sempre fizeram.
 */
function montarResultado(): ResultadoNaTela {
  const rodaram = [...achadosPorAnalisador.keys()];
  const achados = rodaram.flatMap((id) => achadosPorAnalisador.get(id) ?? []);

  const contagem: Record<string, number> = {};
  for (const a of achados) contagem[a.severity] = (contagem[a.severity] ?? 0) + 1;

  const rotulos: Record<string, string> = {};
  for (const s of Object.keys(ORDEM_SEV)) rotulos[s] = t(`severity.${s}` as MessageKey);

  // A degradação sai do canal de saída e vem para a tela: "rodou sem o
  // analisador X" é informação sobre o RESULTADO, e quem lê o resultado está
  // olhando o painel. Repetida por analisador, sem duplicar a frase.
  const avisos = [...new Set([...avisosPorAnalisador.values()].flat())];

  // Os requisitos que a modelagem extraiu. Sem contador e fora da lista de
  // achados de propósito: são o CONTRATO que as regras de negócio conferem, e
  // não problemas encontrados — é a lição do UX-22.
  const requisitos = requisitosGuardados;

  return {
    contagem,
    rotulos,
    avisos,
    requisitos,
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
        .map((a) => {
          // Quem responde se dá para corrigir é o CORRETOR do analisador, não
          // uma suposição daqui — é ele que sabe que dependência sem versão
          // corrigida não tem correção possível. E o motivo é exibido, não
          // engolido: caixa ausente sem explicação parece defeito.
          const fixer = getAnalyzer(a.analyzer)?.fix;
          const pode = fixer?.can(paraFinding(a));
          return {
            chave: chaveDe(a),
            titulo: a.title,
            local: a.line ? `${a.file}:${a.line}` : a.file,
            severidade: a.severity,
            corrigivel: !!pode?.ok,
            motivo: pode?.ok
              ? undefined
              : pode
                ? t(pode.reasonKey)
                : // Analisador SEM corretor. O de skills é assim de propósito:
                  // reescrever um prompt automaticamente entregaria um texto
                  // que ninguém revisou. Fica declarado, não em branco.
                  t("panel.fixNoAutoFix"),
          };
        }),
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
    const s = await pedirContaComServidorPronto();
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
        skills: arquivosDeSkill(),
        // Primeira abertura: já vêm marcados os que não custam IA. É o padrão
        // que a configuração `analyzers.enabled` sempre declarou, e evita a
        // tela abrir com o botão desabilitado e nada explicando o porquê.
        selecionados: selecao.length
          ? selecao
          : (cfg().get<AnalyzerId[]>("analyzers.enabled") ?? ["sast", "sca"]),
        rodando,
        progresso: progressoDaAnalise,
        resultado: ultimoResultado,
        correcoes: correcoesNaTela(),
        pr: prNaTela,
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
      // Os dois: quem clica em cancelar quer parar o que estiver acontecendo,
      // e não escolher entre a análise e a geração de correções.
      abortarAnalise?.abort();
      abortarCorrecao?.abort();
    },
    aoAbrir: async (chave) => {
      const a = achadosPorChave.get(chave);
      const root = raiz();
      if (!a) return;
      const linha = Math.max(0, (a.line ?? 1) - 1);

      // O achado de skill não aponta um caminho do projeto: `file` é o NOME da
      // skill. O caminho de verdade é o que a pessoa escolheu no painel — sem
      // isto, clicar tentava abrir `<raiz>/prompts.md` e falhava em silêncio.
      //
      // `arquivosDeSkill()` e não `skillsEscolhidas`: quando ninguém escolheu
      // arquivo nenhum, a entrada do analisador é o documento ABERTO NO EDITOR
      // (ver `entradaDeSkills`), e a lista de escolhidos está vazia. Era o caso
      // mais comum — validar o prompt que se está escrevendo — e justamente o
      // único em que clicar no achado não fazia absolutamente nada.
      if (a.analyzer === "skills") {
        const caminho = arquivosDeSkill().find((s) => s.nome === a.file)?.caminho;
        if (!caminho) return;
        await vscode.window.showTextDocument(vscode.Uri.file(caminho), {
          selection: new vscode.Range(linha, 0, linha, 0),
        });
        return;
      }

      if (!root) return;
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), a.file);
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

    // Sem `filters`: prompt mora em arquivo de todo tipo de nome — `SKILL.md`,
    // `prompts.md`, `system.txt`, um `.mdc` de regra do editor. Uma lista de
    // extensões aqui esconderia o arquivo que a pessoa veio buscar, e o diálogo
    // do sistema não oferece "todos os arquivos" quando há filtro declarado.
    aoEscolherSkills: async () => {
      const escolha = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFolders: false,
        openLabel: t("panel.skillsPick"),
        title: t("panel.skills"),
      });
      if (!escolha?.length) return;
      skillsEscolhidas = acrescentar(
        skillsEscolhidas,
        escolha.map((u) => u.fsPath)
      );
      await ctxGlobal.workspaceState.update(SKILLS_ESCOLHIDAS, skillsEscolhidas);
      await painel.atualizar();
    },

    aoRemoverSkill: async (caminho) => {
      skillsEscolhidas = skillsEscolhidas.filter((c) => c !== caminho);
      await ctxGlobal.workspaceState.update(SKILLS_ESCOLHIDAS, skillsEscolhidas);
      await painel.atualizar();
    },

    aoCorrigirLote: async (chaves) => {
      await corrigirLote(chaves);
    },

    aoVerCorrecao: async (chave) => {
      const g = propostas.get(chave);
      const principal = g?.proposta?.changes[0];
      if (!principal) return;
      await mostrarDiff(principal);
      // A explicação da IA acompanha o diff. Sem ela, o que se revisa é um
      // conjunto de linhas trocadas sem motivo declarado.
      if (g?.proposta?.explanation) {
        void vscode.window.showInformationMessage(g.proposta.explanation);
      }
    },

    aoAplicarCorrecao: async (chave) => {
      await aplicarCorrecoes([chave]);
    },

    aoAplicarTudo: async () => {
      await aplicarCorrecoes(
        [...propostas.values()].filter((p) => p.estado === "pronta").map((p) => p.chave)
      );
    },

    aoDescartarCorrecoes: async () => {
      // Nada foi gravado: descartar é esquecer, não desfazer.
      propostas.clear();
      // O PR sai junto: ele é a saída DESTAS propostas, e um "PR #12 aberto"
      // pendurado sobre uma lista vazia não diz respeito a nada que esteja
      // na tela.
      prNaTela = { abrindo: false };
      await painel.atualizar();
    },

    aoAbrirPr: async () => {
      await abrirPr();
    },

    aoVerPr: async () => {
      if (prNaTela.url) await vscode.env.openExternal(vscode.Uri.parse(prNaTela.url));
    },

    aoAgirNoCartao: async (comando) => {
      // A allowlist é conferida AQUI, no lado da extensão, e não confiando no
      // que a página mandou: a ponte de mensagens é o limite de confiança, e
      // do outro lado dela há texto de repositório de terceiros.
      const permitido = SAIDAS.some((s) => s.comando === comando);
      if (!permitido) {
        saida.appendLine(`[painel] comando recusado: ${comando}`);
        return;
      }
      await vscode.commands.executeCommand(comando);
    },
  };
}



/**
 * O diagnóstico do SERVIDOR — AUDITORIA.md#ARQ-15.
 *
 * Com o transporte remoto, o `probe` de `sast` e `sca` responde "ok, servidor"
 * sem nunca perguntar ao servidor se ELE tem os scanners. O resultado é o pior
 * tipo de resposta: a tela diz ✔ e a análise não encontra nada, porque do outro
 * lado não há opengrep nem trivy instalados.
 *
 * Aconteceu de verdade, e custou horas: a produção respondia `"status":
 * "degraded"` com os dois scanners ausentes enquanto o editor mostrava tudo
 * verde. É o UX-15 — não confundir "não encontrou" com "não procurou" —
 * atravessando a fronteira do processo.
 *
 * `/api/health` é pública de propósito: não precisa de sessão e não expõe
 * segredo. Falha de rede aqui não é erro do diagnóstico, é informação.
 */
async function diagnosticarServidor(): Promise<void> {
  if (!usingRemoteScan()) return;

  saida.appendLine("");
  saida.appendLine(`Servidor (${servidor()})`);
  try {
    const res = await fetch(`${servidor()}/api/health`, {
      signal: AbortSignal.timeout(20_000),
    });
    const corpo = (await res.json()) as {
      status?: string;
      db?: string;
      scanners?: { name: string; configured: string; present: boolean }[];
      scannersMessage?: string;
      scan?: {
        slots: number;
        busy: number;
        waiting: number;
        jobs: number;
        activeJobs: number;
      };
    };
    saida.appendLine(`  status: ${corpo.status ?? res.status} · banco: ${corpo.db ?? "?"}`);

    // A fila, em números.
    //
    // "Está lento" e "está cheio" pedem consertos diferentes, e sem estes
    // números não havia como distinguir os dois sem acesso ao servidor — foi
    // parte do que fez a investigação da fila presa demorar tanto.
    // Ver AUDITORIA.md#ARQ-16.
    if (corpo.scan) {
      const { slots, busy, waiting, activeJobs } = corpo.scan;
      saida.appendLine(
        `  fila: ${busy}/${slots} scanner(s) em uso · ${waiting} esperando vaga · ${activeJobs} scan(s) ativo(s)`
      );
    }

    for (const s of corpo.scanners ?? []) {
      saida.appendLine(
        s.present
          ? `  ✔ ${s.name} — ${s.configured} instalado no servidor`
          : `  ✖ ${s.name} — ${s.configured} AUSENTE no servidor: o scan roda e não encontra nada`
      );
    }
    // O aviso repetido em voz alta: um scanner ausente do outro lado é o
    // motivo mais provável de "analisou e não achou nada".
    if ((corpo.scanners ?? []).some((s) => !s.present)) {
      saida.appendLine("");
      saida.appendLine(
        "  O servidor não tem os scanners instalados. Enquanto isso, o scan remoto"
      );
      saida.appendLine(
        "  não produz achados — instale-os no host ou use os binários locais."
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    saida.appendLine(`  ✖ não respondeu: ${msg}`);
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
  // Os arquivos de skill sobrevivem ao recarregar da janela: quem apontou o
  // `prompts.md` não deve reapontá-lo a cada reinício do editor.
  skillsEscolhidas = ctx.workspaceState.get<string[]>(SKILLS_ESCOLHIDAS) ?? [];
  saida = vscode.window.createOutputChannel("StarGuard");
  colecoes = new Map(
    ANALYZER_IDS.map((id) => [
      id,
      vscode.languages.createDiagnosticCollection(`starguard/${id}`),
    ])
  );
  painel = new PainelStarGuard(ctx.extensionUri, ganchosDoPainel());
  // Falha de gancho vai para o MESMO canal da análise: quem relata um problema
  // não deveria ter de adivinhar qual dos canais abrir.
  painel.aoFalhar = (linha) => saida.appendLine(linha);

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
      // Limpar é limpar TUDO o que descende dos achados. As propostas ficavam
      // para trás apontando para achados que já não existiam: o bloco de
      // correções continuava oferecendo "Aplicar" e o botão de PR continuava
      // contando arquivos, sobre uma lista de resultado vazia.
      achadosPorAnalisador.clear();
      avisosPorAnalisador.clear();
      requisitosGuardados = [];
      estadoDosCartoes.clear();
      propostas.clear();
      prNaTela = { abrindo: false };
      ultimoResultado = null;
      void painel.atualizar({ resultado: null });
    }),

    // A saída oferecida no analisador bloqueado por falta de IA. É o mesmo
    // consentimento de sempre — só que pedido no momento em que a pessoa
    // demonstrou querer aquele analisador, e não no meio de uma análise.
    vscode.commands.registerCommand("starguard.enableAccountAi", async () => {
      if (!(await pedirContaComServidorPronto())) return;
      await configurarIa(ctxGlobal);
      await painel.atualizar();
    }),

    vscode.commands.registerCommand("starguard.requestAccess", async () => {
      // Quem instalou da Marketplace sem conta precisa de uma saída que não
      // seja a aba de avaliações.
      await vscode.env.openExternal(vscode.Uri.parse(urlDeAcesso()));
    }),

    // A saída oferecida pelo cartão quando o executável não está no PATH.
    //
    // Abre a tela de configurações JÁ FILTRADA: mandar a pessoa procurar
    // `starguard.semgrepPath` no meio de todas as configurações do editor é
    // oferecer uma saída que ela não vai encontrar.
    vscode.commands.registerCommand("starguard.configurarCaminhos", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "starguard.semgrepPath"
      );
    }),

    vscode.commands.registerCommand("starguard.signIn", comandoEntrar),

    // O PR também pela paleta: quem tem o painel fechado precisa de um caminho.
    vscode.commands.registerCommand("starguard.openPullRequest", async () => {
      painel.revelar();
      await abrirPr();
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

      // O ruleset do SAST, dito ANTES de alguém esperar por ele.
      //
      // `--config auto` NÃO funciona com opengrep: exit 2, saída vazia, depois
      // de ~27 s tentando a rede. Sem regras não há scan de código nenhum — e a
      // pessoa precisa saber disso aqui, não depois de uma análise que morre
      // com `Unexpected end of JSON input`. Ver AUDITORIA.md#ARQ-18.
      const { regrasDoSast, limparCacheDeRegras } = await import(
        "@starguard/core/sast-rules"
      );
      limparCacheDeRegras(); // o diagnóstico mostra o estado de AGORA
      const regras = regrasDoSast();
      saida.appendLine("");
      saida.appendLine(
        regras.origem === "env"
          ? `✔ Regras do SAST: ${regras.config} (configurado)`
          : regras.origem === "detectado"
            ? `✔ Regras do SAST: ${regras.config} (encontrado no disco)`
            : "✖ Regras do SAST: NENHUMA encontrada. O opengrep não escaneia sem elas —\n" +
              "  `--config auto` é do Semgrep e aqui só gasta 27 s para falhar. Clone\n" +
              "  github.com/opengrep/opengrep-rules e aponte o caminho em\n" +
              "  starguard.sastRules."
      );

      await diagnosticarServidor();
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
