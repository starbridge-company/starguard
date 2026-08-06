// ============================================================
// O HTML do painel — AUDITORIA.md#UX-20.
//
// Separado do `painel.ts` por um motivo prático: `painel.ts` importa `vscode`,
// que não resolve fora do extension host. Geração de marcação é lógica pura e
// merece teste — sobretudo a parte que **escapa texto**, que é a única defesa
// contra um achado de scanner virar HTML executável aqui dentro.
//
// Sobre isso: o conteúdo que este painel exibe vem de FORA. Título de regra do
// Opengrep, nome de pacote do Trivy, descrição escrita por um modelo. Nada
// disso é confiável, e um webview é uma página web de verdade. Todo texto
// dinâmico passa por `esc()`, e o `<script>` só recebe dados via
// `postMessage` — nunca interpolados na marcação.
//
// A folha de estilo usa apenas variáveis `--vscode-*`. Cor fixa aqui destoa
// em metade dos temas e fica ilegível em alguns; as variáveis fazem o painel
// pertencer ao editor de quem instalou, em vez de parecer um site embutido.
// ============================================================

export interface TextosDoPainel {
  titulo: string;
  entrar: string;
  entrarSub: string;
  solicitar: string;
  analisadores: string;
  selecionarTudo: string;
  limpar: string;
  analisar: string;
  analisando: string;
  cancelar: string;
  descreverSistema: string;
  descricaoAjuda: string;
  descricaoVazia: string;
  skills: string;
  skillsAjuda: string;
  skillsVazio: string;
  skillsAdicionar: string;
  skillsRemover: string;
  skillsDoEditor: string;
  // Seleção e correção em lote. Os que trazem `{n}` chegam CRUS: o número só
  // existe no navegador, e a frase montada aqui seria remontada lá de todo
  // jeito. A substituição é do `fmt()` da página.
  marcarTudo: string;
  desmarcar: string;
  corrigirSelecionados: string;
  correcoes: string;
  correcoesAjuda: string;
  gerandoCorrecoes: string;
  estadoGerando: string;
  estadoPronta: string;
  estadoAplicada: string;
  estadoSemMudanca: string;
  estadoErro: string;
  estadoCancelada: string;
  verDiff: string;
  aplicar: string;
  aplicarTudo: string;
  descartar: string;
  umAchado: string;
  nAchados: string;
  maisArquivos: string;
  nadaMarcado: string;
  filtrarTudo: string;
  filtrarAjuda: string;
  degradado: string;
  requisitos: string;
  requisitosAjuda: string;
  resultado: string;
  semAchados: string;
  aindaNaoRodou: string;
  indisponivel: string;
  // Pull Request: um só, com todas as correções prontas da rodada.
  pr: string;
  prHint: string;
  prBase: string;
  prAbrindo: string;
  prVer: string;
  prAberto: string;
  // Barra de progresso. `{feitos}`/`{total}` chegam CRUS: os números só
  // existem na página, e a frase seria remontada lá de todo jeito.
  progresso: string;
  progressoAguarde: string;
  corrigir: string;
  diagnostico: string;
  sair: string;
  nenhumSelecionado: string;
  privacidade: string;
}

/**
 * JSON para dentro de um `<script>`.
 *
 * `JSON.stringify` escapa aspas, mas **não escapa `<`** — e uma string que
 * contenha `</script>` FECHA o bloco ali mesmo, jogando o resto do JSON como
 * marcação. `\u003c` é lido pelo parser de JavaScript como `<` e não é
 * reconhecido pelo parser de HTML, que é o que fecha a tag.
 *
 * Hoje o único conteúdo que passa por aqui é o nosso dicionário, e nada nele
 * tem `</script>`. Isto não é motivo para deixar aberto: a distância entre
 * "texto nosso" e "texto de fora" é uma chave nova de tradução.
 */
export function jsonSeguroEmScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A página inteira.
 *
 * Recebe o `nonce` e a `cspSource` do chamador porque quem sabe deles é o
 * `Webview` — e sem os dois o `<script>` não roda. Deixar a política de fora
 * seria abrir o painel para qualquer coisa que um achado carregue.
 */
export function htmlDoPainel(opts: {
  nonce: string;
  cspSource: string;
  textos: TextosDoPainel;
}): string {
  const { nonce, cspSource } = opts;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --gap: 10px;
    --raio: 6px;
    --borda: var(--vscode-widget-border, rgba(128,128,128,.35));
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 12px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .linha { display: flex; align-items: center; gap: 8px; }
  .entre { justify-content: space-between; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }

  /* ---- Cabeçalho ---- */
  .conta {
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 10px; margin-bottom: 12px;
    border-bottom: 1px solid var(--borda);
  }
  .conta .email {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px;
  }
  .ponto-conta {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--vscode-testing-iconPassed, #3fb950);
    flex-shrink: 0;
  }

  /* ---- Cartões de analisador ----
     Cartão inteiro clicável, e não só a caixinha: alvo de clique de 16px é
     desconfortável numa barra lateral estreita. */
  .cartoes { display: grid; gap: 6px; }
  .cartao {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    padding: 9px 11px;
    border: 1px solid var(--borda);
    border-radius: var(--raio);
    cursor: pointer;
    background: var(--vscode-editorWidget-background, transparent);
    transition: border-color .12s, background .12s;
  }
  .cartao:hover:not(.off) { border-color: var(--vscode-focusBorder); }
  .cartao.on {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground, var(--vscode-editorWidget-background));
  }
  .cartao.off { opacity: .55; cursor: not-allowed; }
  .cartao .marca {
    grid-row: 1 / span 2;
    width: 16px; height: 16px; margin-top: 2px;
    border: 1.5px solid var(--vscode-descriptionForeground);
    border-radius: 4px;
    display: grid; place-items: center;
    font-size: 11px; line-height: 1;
    flex-shrink: 0;
  }
  .cartao.on .marca {
    background: var(--vscode-button-background);
    border-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .cartao .nome { font-size: 13px; font-weight: 500; }
  /* Marca de "tem explicação aqui". Discreta de propósito: ela avisa, não
     compete com o nome do analisador. */
  .cartao .ajuda {
    margin-left: 5px; font-size: 11px; opacity: .6;
    color: var(--vscode-descriptionForeground);
  }
  .cartao:hover .ajuda { opacity: 1; }
  .cartao .sub { font-size: 11px; color: var(--vscode-descriptionForeground); }
  /* A saída do cartão indisponível. O cartão inteiro está a .55 de opacidade;
     o botão volta a 1 porque ele é a única coisa clicável ali. */
  .cartao .saida {
    margin-top: 6px; opacity: 1; font-size: 11px;
    border-color: var(--vscode-focusBorder);
  }
  .cartao.off { pointer-events: auto; }
  .cartao.off .saida { cursor: pointer; }

  /* Estado por analisador durante a execução. */
  .cartao .estado { font-size: 11px; }
  .girando { display: inline-block; animation: gira 1s linear infinite; }
  @keyframes gira { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .girando { animation: none; } }

  /* ---- Descrição do sistema ---- */
  details.bloco {
    margin-top: 12px;
    border: 1px solid var(--borda);
    border-radius: var(--raio);
    padding: 9px 11px;
  }
  details.bloco > summary {
    cursor: pointer; font-size: 12px; font-weight: 500;
    list-style: none; display: flex; align-items: center; gap: 6px;
  }
  details.bloco > summary::-webkit-details-marker { display: none; }
  details.bloco > summary::before { content: "▸"; font-size: 10px; }
  details.bloco[open] > summary::before { content: "▾"; }
  textarea {
    width: 100%; margin-top: 8px; min-height: 110px; resize: vertical;
    padding: 8px; border-radius: 4px;
    font-family: var(--vscode-font-family); font-size: 12px; line-height: 1.5;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--borda));
  }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }

  /* ---- Arquivos de skill ---- */
  .arquivos { display: grid; gap: 4px; margin-top: 8px; }
  .arquivo {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 7px; border-radius: 4px; font-size: 12px;
    background: var(--vscode-editorWidget-background, transparent);
    border: 1px solid var(--borda);
  }
  .arquivo .nome-arq {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* O que veio do editor não tem ✕: não foi escolhido, foi herdado — some
     sozinho quando a pessoa troca de aba ou escolhe um arquivo. */
  .arquivo.herdado { border-style: dashed; opacity: .8; }

  /* ---- Botões ---- */
  button {
    font-family: inherit; font-size: 13px;
    border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  button.fantasma {
    background: transparent;
    color: var(--vscode-textLink-foreground);
    padding: 3px 6px; font-size: 11px;
  }
  button.fantasma:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }
  #rodar { width: 100%; margin-top: 12px; font-weight: 600; padding: 10px; }

  /* ---- Resultado ---- */
  .placar { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 8px; }
  .chip {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; padding: 3px 9px; border-radius: 20px;
    border: 1px solid var(--borda);
  }
  .bolinha { width: 7px; height: 7px; border-radius: 50%; }
  .critical, .bolinha.critical { --c: var(--vscode-charts-red, #f85149); }
  .high,     .bolinha.high     { --c: var(--vscode-charts-orange, #db6d28); }
  .medium,   .bolinha.medium   { --c: var(--vscode-charts-yellow, #d29922); }
  .low,      .bolinha.low      { --c: var(--vscode-charts-blue, #58a6ff); }
  .info,     .bolinha.info     { --c: var(--vscode-descriptionForeground); }
  .bolinha { background: var(--c); }

  .grupo { margin-top: 10px; }
  .grupo > .cab {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; font-weight: 500; margin-bottom: 4px;
  }
  .achado {
    display: grid; grid-template-columns: auto auto 1fr auto; gap: 8px;
    align-items: start;
    padding: 6px 8px; border-radius: 4px; cursor: pointer;
  }
  .achado:hover { background: var(--vscode-list-hoverBackground); }
  .achado .tit { font-size: 12px; }
  .achado .loc {
    font-size: 11px; color: var(--vscode-descriptionForeground);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .achado .bolinha { margin-top: 5px; }
  .achado .fix { opacity: 0; }
  .achado:hover .fix { opacity: 1; }
  .achado.marcado { background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.12)); }

  /* ---- Seleção para correção em lote ----
     Caixa de verdade e não ícone: numa barra lateral estreita o alvo de clique
     precisa ser óbvio, e o estado marcado precisa sobreviver ao redesenho. */
  .caixa {
    width: 14px; height: 14px; margin-top: 3px;
    border: 1.5px solid var(--vscode-descriptionForeground);
    border-radius: 3px;
    display: grid; place-items: center;
    font-size: 10px; line-height: 1;
    cursor: pointer; flex-shrink: 0;
  }
  .caixa.on {
    background: var(--vscode-button-background);
    border-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  /* Sem correção possível: o lugar da caixa NÃO fica vazio — o motivo vai no
     title, senão a ausência parece defeito da ferramenta (UX-15). */
  .caixa.off { opacity: .35; cursor: not-allowed; border-style: dashed; }

  .barra-lote {
    position: sticky; bottom: 0; z-index: 2;
    margin-top: 10px; padding-top: 8px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-top: 1px solid var(--borda);
  }
  .barra-lote button { width: 100%; }

  /* ---- Filtro por gravidade ---- */
  .chip.filtro { cursor: pointer; user-select: none; }
  .chip.filtro:hover { border-color: var(--vscode-focusBorder); }
  .chip.filtro.on {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground, transparent);
  }

  /* ---- Correções propostas ---- */
  .correcao {
    display: grid; grid-template-columns: 1fr auto; gap: 2px 8px;
    align-items: center;
    padding: 7px 9px; margin-top: 6px;
    border: 1px solid var(--borda); border-radius: var(--raio);
  }
  .correcao .arq {
    font-size: 12px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .correcao .meta { grid-column: 1; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .correcao .acoes { grid-row: 1 / span 2; display: flex; gap: 4px; }
  .correcao.erro { border-color: var(--vscode-charts-red, #f85149); }
  .correcao.aplicada { opacity: .6; }

  /* ---- Barra de progresso ----
     Determinada: o plano sabe quantos analisadores vão rodar antes de o
     primeiro começar. Uma listra indeterminada num trabalho que passa de um
     minuto só prova que o processo não morreu — não informa nada. */
  .progresso { margin: 10px 0 0; }
  .progresso .trilho {
    height: 4px; border-radius: 2px; overflow: hidden;
    background: var(--vscode-progressBar-background, var(--borda));
    opacity: .35;
  }
  .progresso .trilho > i {
    display: block; height: 100%;
    background: var(--vscode-progressBar-background, var(--vscode-button-background));
    transition: width .25s ease;
  }
  .progresso .legenda {
    display: flex; justify-content: space-between; gap: 8px;
    margin-top: 5px; font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .progresso .agora {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .progresso .cronometro { flex-shrink: 0; font-variant-numeric: tabular-nums; }

  /* ---- Pull Request ---- */
  .pr { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--borda); }
  .pr p { margin: 0 0 6px; font-size: 11px; line-height: 1.5; }
  /* O aviso da branch é o único texto do bloco que muda o RESULTADO de clicar:
     ganha a barra à esquerda para não ser lido como mais uma linha de ajuda. */
  .pr .aviso-base {
    padding-left: 8px; margin-bottom: 10px;
    border-left: 2px solid var(--vscode-charts-yellow, #d29922);
  }
  .pr.ok {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; font-size: 12px;
  }

  /* ---- Avisos de degradação ---- */
  .nota {
    margin-top: 8px; padding: 7px 9px; border-radius: 4px;
    font-size: 11px; line-height: 1.5;
    color: var(--vscode-descriptionForeground);
    border-left: 2px solid var(--vscode-charts-yellow, #d29922);
    background: var(--vscode-editorWidget-background, transparent);
  }
  .cartao .aviso-usa {
    grid-column: 2; font-size: 11px; line-height: 1.4; margin-top: 3px;
    color: var(--vscode-charts-yellow, #d29922);
  }
  .req { font-size: 12px; padding: 4px 0; display: flex; gap: 6px; }
  .req .rid { color: var(--vscode-descriptionForeground); flex-shrink: 0; }

  .vazio {
    text-align: center; padding: 20px 10px;
    color: var(--vscode-descriptionForeground); font-size: 12px;
  }

  /* ---- Tela de entrada ---- */
  .porta { padding: 26px 12px; text-align: center; }
  .porta .escudo { font-size: 30px; margin-bottom: 10px; }
  .porta h1 { font-size: 15px; margin: 0 0 6px; }
  .porta p { font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.5; margin: 0 0 16px; }
  .porta button { width: 100%; }
  .porta .depois { margin-top: 12px; font-size: 11px; }

  .aviso {
    margin-top: 10px; padding: 8px 10px; border-radius: 4px;
    font-size: 11px; line-height: 1.5;
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
    background: var(--vscode-inputValidation-errorBackground, rgba(248,81,73,.1));
    border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-charts-red, #f85149));
  }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div id="app"><div class="vazio">…</div></div>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const T = ${jsonSeguroEmScript(opts.textos)};
  let estado = { logado: false, analisadores: [], selecionados: [], descricao: "", skills: [], rodando: false, progresso: null, resultado: null, correcoes: [], pr: { abrindo: false }, erro: null };

  const h = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // Interpolação do lado da página: as frases com {n} chegam cruas do
  // dicionário porque o número só existe aqui. Escapar DEPOIS de montar.
  const fmt = (s, v) => String(s == null ? "" : s)
    .replace(/\\{(\\w+)\\}/g, (_, k) => (v && v[k] != null ? String(v[k]) : ""));

  const SEV = ["critical", "high", "medium", "low", "info"];

  // Estado só da tela — sobrevive ao redesenho porque mora aqui e não no
  // estado que a extensão manda.
  let marcados = new Set();
  let filtro = null;

  const achadosVisiveis = () => {
    const r = estado.resultado;
    if (!r) return [];
    return r.grupos.flatMap((g) => g.achados)
      .filter((a) => !filtro || a.severidade === filtro);
  };

  function porta() {
    return '<div class="porta">' +
      '<div class="escudo">🛡️</div>' +
      '<h1>' + h(T.titulo) + '</h1>' +
      '<p>' + h(T.entrarSub) + '</p>' +
      '<button data-acao="entrar">' + h(T.entrar) + '</button>' +
      '<div class="depois"><button class="fantasma" data-acao="solicitar">' + h(T.solicitar) + '</button></div>' +
    '</div>';
  }

  function cartao(a) {
    const on = estado.selecionados.includes(a.id);
    const off = !a.disponivel;
    // Os selos "IA" e "servidor" saíram daqui. Eram duas etiquetas por cartão
    // dizendo de ONDE vem a execução — informação de bastidor, num lugar onde
    // a pergunta é "isto serve para mim?". O que a pessoa precisa saber sobre
    // custo e velocidade está no tooltip, em "Quando usar".
    // O motivo da indisponibilidade OCUPA a linha de subtítulo: some da
    // execução, nunca da tela. Ver UX-15.
    const sub = off ? h(a.motivo || T.indisponivel)
      : a.estado === 'rodando' && a.detalhe ? h(a.detalhe)
      : h(a.desc);
    const estadoTxt = a.estado === "rodando"
      ? '<span class="girando">◐</span>'
      : a.estado === "erro" ? '⚠'
      : typeof a.achados === "number" ? String(a.achados)
      : '';

    // O que este analisador perde sem os vizinhos que ele USA.
    //
    // Aparece só quando ele está marcado e o vizinho não: é a resposta, na
    // tela, para "regras de negócio depende da modelagem?". Não depende — roda
    // do mesmo jeito —, e a frase diz exatamente o que fica de fora. Um aviso
    // que só existisse no canal de saída não seria lido por ninguém.
    const faltando = on && !off
      ? (a.usa || []).filter((u) => !estado.selecionados.includes(u.id))
      : [];
    const avisoUsa = faltando
      .map((u) => '<div class="aviso-usa">' + h(u.aviso) + '</div>')
      .join('');

    // "O que este analisador faz" vai no title do cartão inteiro, com uma
    // linha por pergunta. Numa barra lateral de 300px é o único lugar onde
    // quatro frases cabem sem empurrar o botão de analisar para fora da tela —
    // e o tooltip nativo já é desenhado pelo editor, no tema do editor.
    //
    // A marca de informação existe só para avisar que há algo a ler ali:
    // tooltip sem marca visível é descoberto por acidente, e o que ele explica
    // é justamente o que decide se a pessoa marca a caixa.
    //
    // (Sem crase em comentário aqui dentro: este bloco mora num template
    // literal, e uma crase solta FECHA a string da página inteira.)
    const sobre = a.sobre ? ' title="' + h(a.sobre) + '"' : '';
    const marcaAjuda = a.sobre ? '<span class="ajuda" aria-hidden="true">ⓘ</span>' : '';

    // A SAÍDA do cartão indisponível.
    //
    // "O executável opengrep não foi encontrado neste computador" dizia o que
    // houve e não o que fazer — e a saída existe, é uma configuração que
    // ninguém acha sozinho numa lista de sete chaves. Ver UX-15.
    const acao = off
      ? (a.acoes || []).map((s) =>
          '<button class="fantasma saida" data-comando="' + h(s.comando) + '">' +
            h(s.rotulo) + '</button>'
        ).join('')
      : '';

    return '<div class="cartao ' + (on ? 'on ' : '') + (off ? 'off' : '') + '" data-id="' + h(a.id) + '"' + sobre + '>' +
      '<div class="marca">' + (on ? '✓' : '') + '</div>' +
      '<div class="linha entre"><span class="nome">' + h(a.nome) + marcaAjuda + '</span><span class="estado">' + estadoTxt + '</span></div>' +
      '<div><div class="sub">' + sub + '</div></div>' +
      acao +
      avisoUsa +
    '</div>';
  }

  // Os chips do placar são o FILTRO. Dois usos numa peça só: numa barra
  // lateral estreita, uma fileira de chips e outra de botões de filtro seria
  // metade da tela gasta dizendo a mesma coisa duas vezes.
  function placar(r) {
    const partes = SEV.filter((s) => r.contagem[s]).map((s) =>
      '<span class="chip filtro ' + (filtro === s ? 'on' : '') + '" data-sev="' + s + '" role="button" tabindex="0" title="' + h(T.filtrarAjuda) + '">' +
        '<span class="bolinha ' + s + '"></span>' + r.contagem[s] + ' ' + h(r.rotulos[s]) +
      '</span>'
    );
    if (!partes.length) return '';
    if (filtro) {
      partes.push('<span class="chip filtro" data-sev="" role="button" tabindex="0">' + h(T.filtrarTudo) + '</span>');
    }
    return '<div class="placar">' + partes.join('') + '</div>';
  }

  function grupos(r) {
    return r.grupos.map((g) => {
      const visiveis = g.achados.filter((a) => !filtro || a.severidade === filtro);
      if (!g.achados.length) {
        return '<div class="grupo"><div class="cab">' + h(g.nome) +
          ' <span class="muted">— ' + h(T.semAchados) + '</span></div></div>';
      }
      if (!visiveis.length) return '';

      const itens = visiveis.map((f) => {
        // A caixa some para quem não tem correção — mas o LUGAR dela não, e o
        // motivo vai no title. Ver UX-15.
        const caixa = f.corrigivel
          ? '<span class="caixa ' + (marcados.has(f.chave) ? 'on' : '') + '" data-marca="' + h(f.chave) + '" role="checkbox" aria-checked="' + (marcados.has(f.chave) ? 'true' : 'false') + '">' +
              (marcados.has(f.chave) ? '✓' : '') + '</span>'
          : '<span class="caixa off" title="' + h(f.motivo || '') + '" aria-hidden="true"></span>';
        return '<div class="achado ' + (marcados.has(f.chave) ? 'marcado' : '') + '" data-chave="' + h(f.chave) + '">' +
          caixa +
          // A bolinha de gravidade fica MESMO com a caixa ao lado: é o único
          // sinal de cor da linha, e trocá-la pela caixa deixaria a lista
          // ordenada por severidade sem mostrar severidade nenhuma.
          '<span class="bolinha ' + h(f.severidade) + '" title="' + h(f.severidade) + '"></span>' +
          '<div><div class="tit">' + h(f.titulo) + '</div><div class="loc">' + h(f.local) + '</div></div>' +
          (f.corrigivel
            ? '<button class="fantasma fix" data-fix="' + h(f.chave) + '">' + h(T.corrigir) + '</button>'
            : '<span></span>') +
        '</div>';
      }).join('');

      return '<div class="grupo"><div class="cab">' + h(g.nome) +
        ' <span class="muted">' + visiveis.length + '</span></div>' + itens + '</div>';
    }).join('');
  }

  /** O que rodou com menos contexto, e os requisitos que a modelagem extraiu. */
  function contexto(r) {
    let html = (r.avisos || [])
      .map((a) => '<div class="nota">' + h(a) + '</div>')
      .join('');

    if ((r.requisitos || []).length) {
      html += '<details class="bloco">' +
        '<summary>' + h(T.requisitos) + ' <span class="muted">' + r.requisitos.length + '</span></summary>' +
        '<p class="muted" style="margin:8px 0 0">' + h(T.requisitosAjuda) + '</p>' +
        r.requisitos.map((q) =>
          '<div class="req"><span class="rid">' + h(q.id) + '</span><span>' + h(q.texto) + '</span></div>'
        ).join('') +
      '</details>';
    }
    return html;
  }

  /** A barra de correção em lote. Só existe quando há o que corrigir. */
  function barraDeLote() {
    const podem = achadosVisiveis().filter((a) => a.corrigivel);
    if (!podem.length) return '';
    const marcadosVisiveis = podem.filter((a) => marcados.has(a.chave)).length;
    const todos = marcadosVisiveis === podem.length;

    return '<div class="barra-lote">' +
      '<div class="linha entre" style="margin-bottom:6px">' +
        '<span class="muted">' + h(fmt(T.nAchados, { n: podem.length })) + '</span>' +
        '<button class="fantasma" data-acao="' + (todos ? 'desmarcarTudo' : 'marcarTudo') + '">' +
          h(todos ? T.desmarcar : T.marcarTudo) + '</button>' +
      '</div>' +
      '<button data-acao="corrigirLote"' + (marcadosVisiveis ? '' : ' disabled') + '>' +
        h(marcadosVisiveis ? fmt(T.corrigirSelecionados, { n: marcadosVisiveis }) : T.nadaMarcado) +
      '</button>' +
    '</div>';
  }

  /**
   * A barra da análise em curso.
   *
   * Fica logo ABAIXO do botão de analisar, que é onde o olho já está depois do
   * clique — e não no fim da página, onde ninguém rolaria para procurar.
   *
   * O cronômetro corre aqui, num setInterval de um segundo que toca APENAS o
   * texto dos dígitos. Redesenhar a página inteira a cada segundo apagaria o
   * que a pessoa estivesse digitando na descrição do sistema — o mesmo cuidado
   * que desenhar() já toma com o foco.
   *
   * (Sem crase em comentário aqui dentro: este bloco mora num template
   * literal, e uma crase solta FECHA a string da página inteira.)
   */
  function barraDeProgresso() {
    const p = estado.progresso;
    if (!estado.rodando || !p || !p.total) return '';
    const pct = Math.min(100, Math.round((p.feitos / p.total) * 100));
    const agora = p.atual
      ? h(p.atual) + (p.detalhe ? ' <span class="muted">· ' + h(p.detalhe) + '</span>' : '')
      : h(T.progressoAguarde);

    return '<div class="progresso">' +
      '<div class="trilho" role="progressbar" aria-valuemin="0" aria-valuemax="' + p.total +
        '" aria-valuenow="' + p.feitos + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="legenda">' +
        '<span class="agora">' + agora + '</span>' +
        '<span class="cronometro" id="cronometro" data-desde="' + (p.desde || 0) + '">' +
          h(fmt(T.progresso, { feitos: p.feitos, total: p.total })) +
        '</span>' +
      '</div>' +
    '</div>';
  }

  /** As propostas geradas — uma por ARQUIVO, nunca uma por achado. */
  function blocoDeCorrecoes() {
    const lista = estado.correcoes || [];
    if (!lista.length) return '';

    const rotulo = {
      gerando: T.estadoGerando, pronta: T.estadoPronta, aplicada: T.estadoAplicada,
      semMudanca: T.estadoSemMudanca, erro: T.estadoErro, cancelada: T.estadoCancelada,
    };
    const prontas = lista.filter((c) => c.estado === 'pronta');
    const gerando = lista.filter((c) => c.estado === 'gerando').length;

    const itens = lista.map((c) => {
      const acoes = c.estado === 'pronta'
        ? '<button class="fantasma" data-ver="' + h(c.chave) + '">' + h(T.verDiff) + '</button>' +
          '<button class="fantasma" data-aplicar="' + h(c.chave) + '">' + h(T.aplicar) + '</button>'
        : '';
      const meta = [
        c.achados === 1 ? T.umAchado : fmt(T.nAchados, { n: c.achados }),
        c.extras ? fmt(T.maisArquivos, { n: c.extras }) : '',
        rotulo[c.estado] || c.estado,
      ].filter(Boolean).join(' · ');
      return '<div class="correcao ' + h(c.estado) + '">' +
        '<div class="arq" title="' + h(c.arquivo) + '">' + h(c.arquivo) + '</div>' +
        '<div class="acoes">' + acoes + '</div>' +
        '<div class="meta">' + h(meta) + (c.erro ? ' — ' + h(c.erro) : '') + '</div>' +
      '</div>';
    }).join('');

    return '<div style="margin-top:16px">' +
      '<div class="linha entre"><h2>' + h(T.correcoes) + '</h2>' +
        '<button class="fantasma" data-acao="descartarCorrecoes">' + h(T.descartar) + '</button>' +
      '</div>' +
      (gerando
        ? '<p class="muted">' + h(fmt(T.gerandoCorrecoes, { done: lista.length - gerando, total: lista.length })) + '</p>'
        : '<p class="muted">' + h(T.correcoesAjuda) + '</p>') +
      itens +
      (prontas.length
        ? '<button style="width:100%;margin-top:8px" data-acao="aplicarTudo">' +
            h(fmt(T.aplicarTudo, { n: prontas.length })) + '</button>'
        : '') +
      blocoDePr(lista) +
    '</div>';
  }

  /**
   * O Pull Request da rodada.
   *
   * Entram as correções PRONTAS e as JÁ APLICADAS: aplicar grava no disco da
   * pessoa e abrir o PR leva a mesma mudança para o repositório — são dois
   * destinos, não duas decisões excludentes. Quem já aplicou e depois quer o PR
   * não deveria ter de gerar tudo de novo.
   *
   * O aviso da branch fica ACIMA do botão, não depois: o PR parte da branch
   * padrão do repositório remoto, e quem tem trabalho local não enviado precisa
   * saber disso antes de clicar, não no relato do que aconteceu.
   */
  function blocoDePr(lista) {
    const levaveis = lista.filter((c) => c.estado === 'pronta' || c.estado === 'aplicada');
    const pr = estado.pr || {};

    if (pr.numero && pr.url) {
      return '<div class="pr ok">' +
        '<span>' + h(fmt(T.prAberto, { n: pr.numero })) + '</span>' +
        '<button class="fantasma" data-acao="verPr">' + h(T.prVer) + '</button>' +
      '</div>';
    }
    if (!levaveis.length) return '';

    return '<div class="pr">' +
      '<p class="muted">' + h(T.prHint) + '</p>' +
      '<p class="muted aviso-base">' + h(T.prBase) + '</p>' +
      (pr.erro ? '<div class="aviso">' + h(pr.erro) + '</div>' : '') +
      '<button style="width:100%" data-acao="abrirPr"' + (pr.abrindo ? ' disabled' : '') + '>' +
        h(pr.abrindo ? T.prAbrindo : fmt(T.pr, { n: levaveis.length })) +
      '</button>' +
    '</div>';
  }

  // O bloco existe SEMPRE, e não só quando o cartão de skills está marcado:
  // era justamente a ausência de um lugar visível que fazia a skill parecer
  // impossível de analisar — o cartão apagava com "sem entrada" e a tela não
  // oferecia saída nenhuma. Abre sozinho quando o analisador está selecionado.
  function blocoDeSkills() {
    const lista = estado.skills || [];
    const itens = lista.map((s) =>
      '<div class="arquivo' + (s.doEditor ? ' herdado' : '') + '" title="' + h(s.caminho) + '">' +
        '<span class="nome-arq">' + h(s.nome) + '</span>' +
        (s.doEditor
          ? '<span class="muted" style="font-size:11px">' + h(T.skillsDoEditor) + '</span>'
          : '<button class="fantasma" data-tira-skill="' + h(s.caminho) +
            '" title="' + h(T.skillsRemover) + '" aria-label="' + h(T.skillsRemover) + '">✕</button>') +
      '</div>'
    ).join('');
    return '<details class="bloco"' + (estado.selecionados.includes('skills') ? ' open' : '') + '>' +
      '<summary>' + h(T.skills) +
        (lista.length ? '' : ' <span class="muted">— ' + h(T.skillsVazio) + '</span>') +
      '</summary>' +
      '<p class="muted" style="margin:8px 0 0">' + h(T.skillsAjuda) + '</p>' +
      (itens ? '<div class="arquivos">' + itens + '</div>' : '') +
      '<div style="margin-top:8px"><button class="fantasma" data-acao="escolherSkills">' +
        h(T.skillsAdicionar) + '</button></div>' +
    '</details>';
  }

  function painel() {
    const a = estado.analisadores;
    const nSel = estado.selecionados.length;
    const podeRodar = nSel > 0 && !estado.rodando;

    let html = '<div class="conta">' +
      '<span class="ponto-conta"></span>' +
      '<span class="email">' + h(estado.conta || '') + '</span>' +
      '<button class="fantasma" data-acao="diagnostico">' + h(T.diagnostico) + '</button>' +
      '<button class="fantasma" data-acao="sair">' + h(T.sair) + '</button>' +
    '</div>';

    html += '<div class="linha entre"><h2>' + h(T.analisadores) + '</h2><div>' +
      '<button class="fantasma" data-acao="tudo">' + h(T.selecionarTudo) + '</button>' +
      '<button class="fantasma" data-acao="nada">' + h(T.limpar) + '</button>' +
    '</div></div>';

    html += '<div class="cartoes">' + a.map(cartao).join('') + '</div>';

    // A descrição do sistema fica FECHADA por padrão: ela só importa para dois
    // dos cinco analisadores, e aberta empurraria o botão de analisar para
    // fora da tela numa barra lateral estreita.
    const temDesc = !!(estado.descricao || '').trim();
    html += '<details class="bloco"' + (temDesc ? '' : '') + '>' +
      '<summary>' + h(T.descreverSistema) +
        (temDesc ? '' : ' <span class="muted">— ' + h(T.descricaoVazia) + '</span>') +
      '</summary>' +
      '<p class="muted" style="margin:8px 0 0">' + h(T.descricaoAjuda) + '</p>' +
      '<textarea id="desc" spellcheck="false">' + h(estado.descricao || '') + '</textarea>' +
    '</details>';

    html += blocoDeSkills();

    html += '<button id="rodar"' + (podeRodar ? '' : ' disabled') + ' data-acao="' +
      (estado.rodando ? 'cancelar' : 'rodar') + '">' +
      (estado.rodando ? h(T.analisando) : nSel ? h(T.analisar) + ' (' + nSel + ')' : h(T.nenhumSelecionado)) +
    '</button>';

    html += barraDeProgresso();

    if (estado.erro) html += '<div class="aviso">' + h(estado.erro) + '</div>';

    html += '<div style="margin-top:16px"><h2>' + h(T.resultado) + '</h2>';
    if (estado.resultado) {
      html += placar(estado.resultado) +
        contexto(estado.resultado) +
        grupos(estado.resultado) +
        barraDeLote();
    } else {
      html += '<div class="vazio">' + h(T.aindaNaoRodou) + '</div>';
    }
    html += '</div>';

    html += blocoDeCorrecoes();

    html += '<p class="muted" style="margin-top:16px;font-size:11px;line-height:1.5">' + h(T.privacidade) + '</p>';
    return html;
  }

  /**
   * O cronômetro da barra.
   *
   * Um setInterval que toca APENAS o texto dos dígitos, e nunca redesenha a
   * página. Redesenhar a cada segundo apagaria o que a pessoa estivesse
   * digitando na descrição do sistema.
   */
  let relogio = null;
  function tique() {
    const el = document.getElementById('cronometro');
    if (!el) { clearInterval(relogio); relogio = null; return; }
    const desde = Number(el.dataset.desde || 0);
    if (!desde) return;
    const seg = Math.max(0, Math.round((Date.now() - desde) / 1000));
    const mm = String(Math.floor(seg / 60)).padStart(2, '0');
    const ss = String(seg % 60).padStart(2, '0');
    el.textContent = el.dataset.base + '  ' + mm + ':' + ss;
  }

  function desenhar() {
    const app = document.getElementById('app');
    // Preserva o que a pessoa está digitando: um redesenho por evento de
    // progresso não pode engolir texto no meio de uma frase.
    const foco = document.activeElement;
    const digitando = foco && foco.id === 'desc';
    const posicao = digitando ? [foco.selectionStart, foco.selectionEnd] : null;

    app.innerHTML = estado.logado ? painel() : porta();

    if (digitando) {
      const t = document.getElementById('desc');
      if (t) {
        t.closest('details').open = true;
        t.focus();
        t.setSelectionRange(posicao[0], posicao[1]);
      }
    }

    // O cronômetro só existe enquanto a barra existir.
    const cron = document.getElementById('cronometro');
    if (cron) {
      cron.dataset.base = cron.textContent;
      tique();
      if (!relogio) relogio = setInterval(tique, 1000);
    } else if (relogio) {
      clearInterval(relogio);
      relogio = null;
    }
  }

  document.addEventListener('click', (e) => {
    // A SAÍDA do cartão indisponível vem antes do cartão: clicar nela é
    // resolver o impedimento, e não tentar marcar um cartão que não marca.
    const comando = e.target.closest('[data-comando]');
    if (comando) {
      e.stopPropagation();
      vscode.postMessage({ tipo: 'acaoCartao', comando: comando.dataset.comando });
      return;
    }
    // A CAIXA vem antes do resto: clicar nela é marcar, não abrir o arquivo.
    const caixa = e.target.closest('[data-marca]');
    if (caixa) {
      e.stopPropagation();
      const k = caixa.dataset.marca;
      if (marcados.has(k)) marcados.delete(k);
      else marcados.add(k);
      desenhar();
      return;
    }
    const ver = e.target.closest('[data-ver]');
    if (ver) {
      e.stopPropagation();
      vscode.postMessage({ tipo: 'verCorrecao', chave: ver.dataset.ver });
      return;
    }
    const aplicar = e.target.closest('[data-aplicar]');
    if (aplicar) {
      e.stopPropagation();
      vscode.postMessage({ tipo: 'aplicarCorrecao', chave: aplicar.dataset.aplicar });
      return;
    }
    const sev = e.target.closest('[data-sev]');
    if (sev) {
      e.stopPropagation();
      const v = sev.dataset.sev;
      filtro = !v || filtro === v ? null : v;
      desenhar();
      return;
    }
    const fix = e.target.closest('[data-fix]');
    if (fix) {
      e.stopPropagation();
      vscode.postMessage({ tipo: 'corrigir', chave: fix.dataset.fix });
      return;
    }
    const tira = e.target.closest('[data-tira-skill]');
    if (tira) {
      e.stopPropagation();
      vscode.postMessage({ tipo: 'removerSkill', caminho: tira.dataset.tiraSkill });
      return;
    }
    const achado = e.target.closest('.achado');
    if (achado) {
      vscode.postMessage({ tipo: 'abrir', chave: achado.dataset.chave });
      return;
    }
    const cartaoEl = e.target.closest('.cartao');
    if (cartaoEl) {
      if (cartaoEl.classList.contains('off')) return;
      const id = cartaoEl.dataset.id;
      const i = estado.selecionados.indexOf(id);
      if (i >= 0) estado.selecionados.splice(i, 1);
      else estado.selecionados.push(id);
      vscode.postMessage({ tipo: 'selecao', ids: estado.selecionados });
      desenhar();
      return;
    }
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const acao = botao.dataset.acao;
    if (acao === 'tudo') {
      estado.selecionados = estado.analisadores.filter((a) => a.disponivel).map((a) => a.id);
      vscode.postMessage({ tipo: 'selecao', ids: estado.selecionados });
      desenhar();
    } else if (acao === 'nada') {
      estado.selecionados = [];
      vscode.postMessage({ tipo: 'selecao', ids: [] });
      desenhar();
    } else if (acao === 'rodar') {
      const t = document.getElementById('desc');
      vscode.postMessage({ tipo: 'analisar', ids: estado.selecionados, descricao: t ? t.value : '' });
    } else if (acao === 'marcarTudo') {
      for (const a of achadosVisiveis()) if (a.corrigivel) marcados.add(a.chave);
      desenhar();
    } else if (acao === 'desmarcarTudo') {
      for (const a of achadosVisiveis()) marcados.delete(a.chave);
      desenhar();
    } else if (acao === 'corrigirLote') {
      // A ordem da TELA é a que vai: é a que a pessoa está vendo, e o
      // agrupamento por arquivo acontece do outro lado.
      const chaves = achadosVisiveis()
        .filter((a) => a.corrigivel && marcados.has(a.chave))
        .map((a) => a.chave);
      vscode.postMessage({ tipo: 'corrigirLote', chaves: chaves });
    } else {
      vscode.postMessage({ tipo: acao });
    }
  });

  // A descrição é gravada ao SAIR do campo, não a cada tecla: escrever na
  // configuração do editor a cada caractere dispara o evento de mudança e
  // recarrega o plano no meio da digitação.
  document.addEventListener('focusout', (e) => {
    if (e.target && e.target.id === 'desc') {
      estado.descricao = e.target.value;
      vscode.postMessage({ tipo: 'salvarDescricao', texto: e.target.value });
    }
  });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.tipo === 'estado') {
      estado = Object.assign(estado, m.estado);
      // Resultado novo, marcação velha: uma chave que não existe mais faria o
      // contador do botão prometer correções que ninguém consegue pedir.
      if (estado.resultado) {
        const vivas = new Set(estado.resultado.grupos.flatMap((g) => g.achados.map((a) => a.chave)));
        marcados = new Set([...marcados].filter((k) => vivas.has(k)));
      } else {
        marcados = new Set();
      }
      desenhar();
    } else if (m.tipo === 'progresso') {
      const a = estado.analisadores.find((x) => x.id === m.id);
      if (a) {
        a.estado = m.estado;
        if (typeof m.achados === 'number') a.achados = m.achados;
        a.detalhe = m.detalhe;
      }
      // O estado "rodando" NÃO vem daqui: o último evento de uma execução
      // sempre dizia que estava rodando, e era isso que deixava o botão
      // girando para sempre depois de tudo pronto. Quem sabe se acabou é a
      // extensão. Ver UX-24.
      desenhar();
    }
  });

  vscode.postMessage({ tipo: 'pronto' });
})();
</script>
</body>
</html>`;
}
