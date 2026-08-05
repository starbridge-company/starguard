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
  resultado: string;
  semAchados: string;
  aindaNaoRodou: string;
  usaIa: string;
  noServidor: string;
  indisponivel: string;
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
  .cartao .sub { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .selos { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px; }
  .selo {
    font-size: 10px; padding: 1px 6px; border-radius: 20px;
    border: 1px solid var(--borda);
    color: var(--vscode-descriptionForeground);
  }
  .selo.ia { border-color: var(--vscode-charts-purple, #a371f7); color: var(--vscode-charts-purple, #a371f7); }
  .selo.serv { border-color: var(--vscode-charts-blue, #58a6ff); color: var(--vscode-charts-blue, #58a6ff); }

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
    display: grid; grid-template-columns: auto 1fr auto; gap: 8px;
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
  let estado = { logado: false, analisadores: [], selecionados: [], descricao: "", rodando: false, resultado: null, erro: null };

  const h = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const SEV = ["critical", "high", "medium", "low", "info"];

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
    const selos =
      (a.usaIa ? '<span class="selo ia">' + h(T.usaIa) + '</span>' : '') +
      (a.remoto ? '<span class="selo serv">' + h(T.noServidor) + '</span>' : '');
    // O motivo da indisponibilidade OCUPA a linha de subtítulo: some da
    // execução, nunca da tela. Ver UX-15.
    const sub = off ? h(a.motivo || T.indisponivel) : h(a.desc);
    const estadoTxt = a.estado === "rodando"
      ? '<span class="girando">◐</span>'
      : a.estado === "erro" ? '⚠'
      : typeof a.achados === "number" ? String(a.achados)
      : '';
    return '<div class="cartao ' + (on ? 'on ' : '') + (off ? 'off' : '') + '" data-id="' + h(a.id) + '">' +
      '<div class="marca">' + (on ? '✓' : '') + '</div>' +
      '<div class="linha entre"><span class="nome">' + h(a.nome) + '</span><span class="estado">' + estadoTxt + '</span></div>' +
      '<div><div class="sub">' + sub + '</div>' + (selos ? '<div class="selos">' + selos + '</div>' : '') + '</div>' +
    '</div>';
  }

  function placar(r) {
    const partes = SEV.filter((s) => r.contagem[s]).map((s) =>
      '<span class="chip"><span class="bolinha ' + s + '"></span>' + r.contagem[s] + ' ' + h(r.rotulos[s]) + '</span>'
    );
    return partes.length ? '<div class="placar">' + partes.join('') + '</div>' : '';
  }

  function grupos(r) {
    return r.grupos.map((g) => {
      if (!g.achados.length) {
        return '<div class="grupo"><div class="cab">' + h(g.nome) +
          ' <span class="muted">— ' + h(T.semAchados) + '</span></div></div>';
      }
      const itens = g.achados.map((f) =>
        '<div class="achado" data-chave="' + h(f.chave) + '">' +
          '<span class="bolinha ' + h(f.severidade) + '"></span>' +
          '<div><div class="tit">' + h(f.titulo) + '</div><div class="loc">' + h(f.local) + '</div></div>' +
          '<button class="fantasma fix" data-fix="' + h(f.chave) + '">' + h(T.corrigir) + '</button>' +
        '</div>'
      ).join('');
      return '<div class="grupo"><div class="cab">' + h(g.nome) +
        ' <span class="muted">' + g.achados.length + '</span></div>' + itens + '</div>';
    }).join('');
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

    html += '<button id="rodar"' + (podeRodar ? '' : ' disabled') + ' data-acao="' +
      (estado.rodando ? 'cancelar' : 'rodar') + '">' +
      (estado.rodando ? h(T.analisando) : nSel ? h(T.analisar) + ' (' + nSel + ')' : h(T.nenhumSelecionado)) +
    '</button>';

    if (estado.erro) html += '<div class="aviso">' + h(estado.erro) + '</div>';

    html += '<div style="margin-top:16px"><h2>' + h(T.resultado) + '</h2>';
    if (estado.resultado) {
      html += placar(estado.resultado) + grupos(estado.resultado);
    } else {
      html += '<div class="vazio">' + h(T.aindaNaoRodou) + '</div>';
    }
    html += '</div>';

    html += '<p class="muted" style="margin-top:16px;font-size:11px;line-height:1.5">' + h(T.privacidade) + '</p>';
    return html;
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
  }

  document.addEventListener('click', (e) => {
    const fix = e.target.closest('[data-fix]');
    if (fix) {
      e.stopPropagation();
      vscode.postMessage({ tipo: 'corrigir', chave: fix.dataset.fix });
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
    if (m.tipo === 'estado') { estado = Object.assign(estado, m.estado); desenhar(); }
    else if (m.tipo === 'progresso') {
      const a = estado.analisadores.find((x) => x.id === m.id);
      if (a) { a.estado = m.estado; if (typeof m.achados === 'number') a.achados = m.achados; }
      estado.rodando = m.rodando;
      desenhar();
    }
  });

  vscode.postMessage({ tipo: 'pronto' });
})();
</script>
</body>
</html>`;
}
