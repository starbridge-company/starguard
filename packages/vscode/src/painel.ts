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
  usaIa: boolean;
  remoto: boolean;
  estado?: "ocioso" | "rodando" | "pronto" | "erro";
  achados?: number;
}

export interface AchadoNaTela {
  chave: string;
  titulo: string;
  local: string;
  severidade: string;
}

export interface ResultadoNaTela {
  contagem: Record<string, number>;
  rotulos: Record<string, string>;
  grupos: { id: string; nome: string; achados: AchadoNaTela[] }[];
}

export interface GanchosDoPainel {
  textos: () => TextosDoPainel;
  /** Cartões e conta — recalculado a cada abertura e a cada mudança. */
  estado: () => Promise<{
    logado: boolean;
    conta?: string;
    analisadores: CartaoDeAnalisador[];
    descricao: string;
    selecionados: AnalyzerId[];
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

    view.webview.onDidReceiveMessage(async (m: { tipo: string } & Record<string, unknown>) => {
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
      }
    });
  }

  /** Reconstrói o estado inteiro e manda para a página. */
  async atualizar(extra?: { resultado?: ResultadoNaTela | null; erro?: string | null }): Promise<void> {
    if (!this.view) return;
    const base = await this.ganchos.estado();
    await this.view.webview.postMessage({ tipo: "estado", estado: { ...base, ...extra } });
  }

  /** Progresso de um analisador, sem reconstruir o resto. */
  progresso(id: AnalyzerId, estado: string, rodando: boolean, achados?: number): void {
    void this.view?.webview.postMessage({ tipo: "progresso", id, estado, rodando, achados });
  }

  /** Traz o painel para a frente — usado quando um comando precisa dele. */
  revelar(): void {
    this.view?.show?.(true);
  }

  get visivel(): boolean {
    return !!this.view?.visible;
  }
}
