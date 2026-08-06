// ============================================================
// O painel lateral — AUDITORIA.md#UX-20.
//
// Substituiu a árvore. A árvore dava uma lista e um ▶ por item; o que faltava
// era o que se pede de uma ferramenta de segurança dentro do editor: escolher
// **várias etapas de uma vez**, ver o que cada uma custa antes de rodar,
// escrever a descrição do sistema num campo de verdade em vez de num JSON de
// configuração, e ler o resultado agrupado por severidade sem sair dali.
//
// A classe não conhece o motor. Ela recebe funções (`aoAnalisar`, `aoCorrigir`,
// …) de quem a constrói. Isso evita ciclo de import com `extension.ts` e, mais
// importante, mantém a interface trocável: o dia em que o painel virar outra
// coisa, o que roda a análise não muda.
// ============================================================
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { htmlDoPainel, type TextosDoPainel } from "./painel-html.js";
import type { AnalyzerId } from "@starguard/core/types";

export interface CartaoDeAnalisador {
  id: AnalyzerId;
  nome: string;
  desc: string;
  disponivel: boolean;
  motivo?: string;
  /**
   * O que fazer a respeito. Motivo sem saída é meio caminho: a pessoa fica
   * sabendo o que houve e não o que resolve. Ver UX-15.
   *
   * Lista porque o binário faltando tem DUAS respostas legítimas: rodar no
   * servidor da conta (zero instalação) ou apontar o caminho do que já está no
   * disco. Escolher uma pela pessoa seria decidir se o código dela pode sair
   * da máquina.
   */
  acoes?: { rotulo: string; comando: string }[];
  estado?: "ocioso" | "rodando" | "pronto" | "erro" | "pulado";
  achados?: number;
  /** Mensagem do próprio analisador enquanto roda ("baixando regras…"). */
  detalhe?: string;
  /**
   * "Para que serve / quando usar / o que entrega / o que corrige", já montado
   * e já traduzido, uma pergunta por linha.
   *
   * Vai para o `title` do cartão, e não para dentro dele: a barra lateral tem
   * uns 300px e cinco cartões com quatro parágrafos cada empurrariam o botão
   * de analisar para fora da tela. Tooltip nativo custa zero pixel e não
   * precisa de balão próprio — que num webview seria script a mais para uma
   * coisa que o editor já sabe desenhar.
   */
  sobre?: string;
  /**
   * Analisadores que ENRIQUECEM este, com a frase que explica o que se perde
   * sem cada um. Não é pré-requisito: o painel mostra o aviso e roda mesmo
   * assim. É a resposta, na tela, para "regras de negócio depende da
   * modelagem?" — ver AUDITORIA.md#UX-25.
   */
  usa?: { id: AnalyzerId; nome: string; aviso: string }[];
}

/** Uma entrada da lista de skills — escolhida a dedo ou herdada do editor. */
export interface ArquivoDeSkill {
  caminho: string;
  nome: string;
  /** Veio do editor aberto, não de uma escolha: não tem botão de remover. */
  doEditor: boolean;
}

export interface AchadoNaTela {
  chave: string;
  titulo: string;
  local: string;
  severidade: string;
  /** Dá para corrigir automaticamente? Quem responde é o `Fixer` do analisador. */
  corrigivel: boolean;
  /** Por que não dá — texto já traduzido, exibido no lugar da caixa. */
  motivo?: string;
}

export interface ResultadoNaTela {
  contagem: Record<string, number>;
  rotulos: Record<string, string>;
  grupos: { id: string; nome: string; achados: AchadoNaTela[] }[];
  /** Frases de degradação da execução — o que rodou sem o contexto do vizinho. */
  avisos: string[];
  /** O que a modelagem de ameaças extraiu. Vazio quando ela não rodou. */
  requisitos: { id: string; texto: string }[];
}

/** Uma correção proposta, por ARQUIVO — nunca por achado. Ver `fix/batch.ts`. */
export interface CorrecaoNaTela {
  chave: string;
  arquivo: string;
  achados: number;
  /** Outros arquivos que a mesma proposta toca (o corretor de agente faz isso). */
  extras: number;
  estado: "gerando" | "pronta" | "semMudanca" | "erro" | "aplicada" | "cancelada";
  erro?: string;
}

/**
 * O Pull Request da rodada de correções.
 *
 * Um só, com TUDO que estiver pronto — e não um por achado. Quem recebe cinco
 * PRs do robô no mesmo dia fecha os cinco sem ler; o agrupamento por arquivo já
 * aconteceu na geração, aqui só se junta o resultado.
 *
 * `abrindo` mora aqui e não no webview pelo mesmo motivo de `rodando`: quem
 * sabe que a chamada ao GitHub terminou é quem a fez. Ver UX-24.
 */
export interface PrNaTela {
  abrindo: boolean;
  numero?: number;
  url?: string;
  erro?: string;
}

/**
 * O andamento da análise, para a barra do painel.
 *
 * Determinada, e não uma listra andando de um lado para o outro: o plano
 * SABE quantos analisadores vão rodar antes de o primeiro começar, e uma barra
 * indeterminada num trabalho que pode passar de um minuto não informa nada —
 * ela só prova que o processo não morreu.
 *
 * `desde` é o instante de início, e o relógio corre no NAVEGADOR. Mandar o
 * tempo decorrido a cada segundo pela ponte de mensagens seria um redesenho
 * por segundo do painel inteiro para mover dois dígitos.
 */
export interface ProgressoNaTela {
  /** Quantos analisadores o plano vai executar. */
  total: number;
  /** Quantos já terminaram — com qualquer desfecho. */
  feitos: number;
  /** Nome do que está rodando agora, já traduzido. */
  atual?: string;
  /** O que ele está fazendo ("servidor", "baixando regras…"). */
  detalhe?: string;
  /** `Date.now()` do início, para o cronômetro da página. */
  desde?: number;
}

export interface GanchosDoPainel {
  textos: () => TextosDoPainel;
  /** Cartões e conta — recalculado a cada abertura e a cada mudança. */
  estado: () => Promise<{
    logado: boolean;
    conta?: string;
    analisadores: CartaoDeAnalisador[];
    descricao: string;
    skills: ArquivoDeSkill[];
    selecionados: AnalyzerId[];
    /**
     * Quem manda no botão é a EXTENSÃO, não o webview.
     *
     * Antes o estado de "analisando" só chegava por evento de progresso, e o
     * último evento de uma execução dizia `rodando: true` — o botão ficava
     * girando para sempre depois que tudo tinha terminado. Ver UX-24.
     */
    rodando: boolean;
    /** Andamento da execução em curso. `null` quando não há nenhuma. */
    progresso: ProgressoNaTela | null;
    resultado?: ResultadoNaTela | null;
    correcoes: CorrecaoNaTela[];
    pr: PrNaTela;
  }>;
  aoEntrar: () => Promise<void>;
  aoSair: () => Promise<void>;
  aoSolicitarAcesso: () => Promise<void>;
  aoDiagnostico: () => Promise<void>;
  aoAnalisar: (ids: AnalyzerId[], descricao: string) => Promise<void>;
  aoCancelar: () => void;
  aoAbrir: (chave: string) => Promise<void>;
  aoCorrigir: (chave: string) => Promise<void>;
  aoSalvarDescricao: (texto: string) => Promise<void>;
  aoMudarSelecao: (ids: AnalyzerId[]) => Promise<void>;
  aoEscolherSkills: () => Promise<void>;
  aoRemoverSkill: (caminho: string) => Promise<void>;
  /** Correção em LOTE: uma proposta por arquivo, não por achado. */
  aoCorrigirLote: (chaves: string[]) => Promise<void>;
  aoVerCorrecao: (chave: string) => Promise<void>;
  aoAplicarCorrecao: (chave: string) => Promise<void>;
  aoAplicarTudo: () => Promise<void>;
  aoDescartarCorrecoes: () => Promise<void>;
  /** Um PR só, com todas as correções prontas da rodada. */
  aoAbrirPr: () => Promise<void>;
  /** Abre no navegador o PR que acabou de sair. */
  aoVerPr: () => Promise<void>;
  /** A saída oferecida por um cartão indisponível. Passa por allowlist. */
  aoAgirNoCartao: (comando: string) => Promise<void>;
}

export class PainelStarGuard implements vscode.WebviewViewProvider {
  public static readonly ID = "starguard.painel";
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ganchos: GanchosDoPainel
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // ------------------------------------------------------------
    // Soltar a referência quando o editor descarta o webview.
    //
    // Esta linha é a raiz do "Analisando… para sempre". Com
    // `retainContextWhenHidden: false`, esconder a barra lateral DESTRÓI o
    // webview — e sem este `onDidDispose` a extensão continuava segurando o
    // objeto morto. O `postMessage` seguinte rejeitava, a rejeição subia por
    // `atualizar()`, e `atualizar()` é esperado no meio de `analisar()`: a
    // execução morria ali, com `rodando` preso em `true`. A partir daí todo
    // clique em Analisar caía no `if (rodando) return` e não acontecia nada
    // até recarregar a janela.
    //
    // Duas defesas, não uma: esta, que evita falar com um webview morto, e o
    // `catch` de `postar()`, para o caso de a morte acontecer no meio do envio.
    // ------------------------------------------------------------
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    view.webview.options = {
      enableScripts: true,
      // Nenhum recurso local é carregado: o painel é uma página só, com o CSS
      // e o script embutidos. Restringir a raiz mesmo assim é barato.
      localResourceRoots: [this.extensionUri],
    };
    // `retainContextWhenHidden` NÃO é usado: o painel guarda o estado do lado
    // da extensão, então reconstruí-lo ao reabrir é barato e não desperdiça
    // memória do editor com um webview parado.
    view.webview.html = htmlDoPainel({
      nonce: randomBytes(16).toString("base64"),
      cspSource: view.webview.cspSource,
      textos: this.ganchos.textos(),
    });

    // Todo clique do painel entra por aqui, e uma exceção num gancho vira
    // rejeição não tratada: o editor não mostra nada e o clique simplesmente
    // não faz efeito. Quem clicou fica sem saber se esperou pouco ou se
    // quebrou. O `catch` transforma o silêncio em mensagem.
    view.webview.onDidReceiveMessage(async (m: { tipo: string } & Record<string, unknown>) => {
      try {
        await this.despachar(m);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.aoFalhar?.(`[painel:${m.tipo}] ${msg}`);
        void vscode.window.showErrorMessage(`StarGuard · ${msg.split("\n")[0]}`);
      }
    });
  }

  /** Log de falha do painel — ligado pela extensão ao canal de saída. */
  public aoFalhar?: (linha: string) => void;

  private async despachar(m: { tipo: string } & Record<string, unknown>): Promise<void> {
    {
      switch (m.tipo) {
        case "pronto":
          await this.atualizar();
          break;
        case "entrar":
          await this.ganchos.aoEntrar();
          break;
        case "sair":
          await this.ganchos.aoSair();
          break;
        case "solicitar":
          await this.ganchos.aoSolicitarAcesso();
          break;
        case "diagnostico":
          await this.ganchos.aoDiagnostico();
          break;
        case "analisar":
          await this.ganchos.aoAnalisar(
            (m.ids as AnalyzerId[]) ?? [],
            (m.descricao as string) ?? ""
          );
          break;
        case "cancelar":
          this.ganchos.aoCancelar();
          break;
        case "abrir":
          await this.ganchos.aoAbrir(m.chave as string);
          break;
        case "corrigir":
          await this.ganchos.aoCorrigir(m.chave as string);
          break;
        case "salvarDescricao":
          await this.ganchos.aoSalvarDescricao(m.texto as string);
          break;
        case "selecao":
          await this.ganchos.aoMudarSelecao((m.ids as AnalyzerId[]) ?? []);
          break;
        case "escolherSkills":
          await this.ganchos.aoEscolherSkills();
          break;
        case "removerSkill":
          await this.ganchos.aoRemoverSkill(m.caminho as string);
          break;
        case "corrigirLote":
          await this.ganchos.aoCorrigirLote((m.chaves as string[]) ?? []);
          break;
        case "verCorrecao":
          await this.ganchos.aoVerCorrecao(m.chave as string);
          break;
        case "aplicarCorrecao":
          await this.ganchos.aoAplicarCorrecao(m.chave as string);
          break;
        case "aplicarTudo":
          await this.ganchos.aoAplicarTudo();
          break;
        case "descartarCorrecoes":
          await this.ganchos.aoDescartarCorrecoes();
          break;
        case "abrirPr":
          await this.ganchos.aoAbrirPr();
          break;
        case "verPr":
          await this.ganchos.aoVerPr();
          break;
        case "acaoCartao":
          await this.ganchos.aoAgirNoCartao(m.comando as string);
          break;
      }
    }
  }

  /**
   * Manda uma mensagem para a página sem NUNCA lançar.
   *
   * Desenhar a tela não pode derrubar quem estava fazendo o trabalho. O
   * `postMessage` de um webview que acabou de ser descartado rejeita, e essa
   * rejeição já subiu por `atualizar()` até o meio de uma análise, deixando o
   * botão preso em "Analisando…". Falhar em pintar a tela é um problema
   * pequeno; falhar em terminar a análise é o problema grande.
   */
  private async postar(msg: Record<string, unknown>): Promise<void> {
    const view = this.view;
    if (!view) return;
    try {
      await view.webview.postMessage(msg);
    } catch {
      /* webview descartado no meio do envio — a próxima abertura redesenha. */
    }
  }

  /**
   * Reconstrói o estado inteiro e manda para a página.
   *
   * O `try` cobre `ganchos.estado()`, que monta o plano do orquestrador e
   * consulta a sessão: as duas coisas fazem E/S e podem falhar. Antes essa
   * falha viajava para quem chamou — e quem chama é, entre outros, o `finally`
   * que desliga o botão de Analisar.
   */
  async atualizar(extra?: { resultado?: ResultadoNaTela | null; erro?: string | null }): Promise<void> {
    if (!this.view) return;
    let base;
    try {
      base = await this.ganchos.estado();
    } catch {
      return;
    }
    await this.postar({ tipo: "estado", estado: { ...base, ...extra } });
  }

  /**
   * Progresso de um analisador, sem reconstruir o resto.
   *
   * `rodando` não vem daqui de propósito — quem sabe se a execução acabou é
   * quem a conduz, e um evento de progresso nunca soube disso. Ver UX-24.
   */
  progresso(
    id: AnalyzerId,
    estado: string,
    extra: { achados?: number; detalhe?: string } = {}
  ): void {
    void this.postar({ tipo: "progresso", id, estado, ...extra });
  }

  /** Traz o painel para a frente — usado quando um comando precisa dele. */
  revelar(): void {
    this.view?.show?.(true);
  }

  get visivel(): boolean {
    return !!this.view?.visible;
  }
}
