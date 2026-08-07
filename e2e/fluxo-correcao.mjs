import { chromium } from "playwright";
// A análise é DESCOBERTA, não escrita no código: ver o cabeçalho de `comum.mjs`.
import { BASE, acharAnalise, entrar, semAnalise } from "./comum.mjs";

// O destino das capturas era um diretório de sessão de OUTRA máquina, que não
// existe em lugar nenhum hoje. Sem `E2E_SHOTS`, não se captura nada — a suíte
// afirma pelo DOM, e a imagem é conveniência de quem está depurando.
const OUT = process.env.E2E_SHOTS || "";

let falhas = 0;
const check = (c, m) => {
  if (!c) falhas++;
  console.log(`  ${c ? "✓" : "✗ FALHOU"}  ${m}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

/** Captura só quando `E2E_SHOTS` aponta um diretório. A afirmação é do DOM. */
const capturar = async (nome) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${nome}` });
};
const erros = [];
page.on("pageerror", (e) => erros.push(String(e)));
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

// `entrar` fixa o idioma junto: sem isso a suíte depende do que a `idioma.mjs`
// tiver deixado salvo na conta. Ver o cabeçalho de `comum.mjs`.
await entrar(page);

const ID = await acharAnalise(page);
if (!ID) semAnalise();
await page.goto(`${BASE}/results/${ID}`, { waitUntil: "networkidle" });
await page.click('button:has-text("Correções")');
await page.waitForTimeout(1200);

const cards = () => page.locator(".finding-list .vuln-card").count();
const busca = async (t) => {
  await page.fill(".flt-search-input", t);
  await page.waitForTimeout(500);
};

console.log("\n=== UX-01 · FILTROS E PAGINAÇÃO ===");
// ---- As asserções aqui são RELATIVAS, e isso é o conserto ----
//
// Eram absolutas: 25 cards, "esperado 3", "esperado 19", "SAST 25 · IA 6".
// Números do CONTEÚDO de uma análise específica, que só existiu no banco de
// quem escreveu a suíte. Contra qualquer outra análise o teste acusava falha
// sem que nada estivesse quebrado — e um teste que reprova o certo é pior que
// nenhum, porque ensina a ignorar a saída vermelha.
//
// O que se afirma agora é o COMPORTAMENTO: paginar revela mais, filtrar reduz,
// buscar restringe, limpar restaura. Isso vale para qualquer análise.
const inicial = await cards();
check(inicial > 0, `a lista renderiza achados (${inicial} na primeira página)`);

if (await page.locator('button:has-text("Mostrar mais")').count()) {
  await page.click('button:has-text("Mostrar mais")');
  await page.waitForTimeout(400);
  const todos = await cards();
  check(todos > inicial, `"Mostrar mais" revela mais: ${inicial} -> ${todos}`);
} else {
  check(true, `os ${inicial} achados couberam numa página só`);
}

const total = await cards();

// Filtrar nunca AUMENTA a lista, e as partes não passam do todo.
let soma = 0;
for (const sev of ["Crítica", "Alta", "Média", "Baixa"]) {
  const botao = page.locator(`.segmented button:has-text("${sev}")`).first();
  if (!(await botao.count())) continue;
  await botao.click();
  await page.waitForTimeout(350);
  const n = await cards();
  soma += n;
  check(n <= total, `filtro ${sev}: ${n} card(s), nunca mais que o total (${total})`);

  // Zero COM filtro tem de mostrar o vazio de FILTRO, e não "🎉 tudo limpo":
  // a diferença entre "não há" e "não há COM ESTE FILTRO" é a do UX-15, e numa
  // ferramenta de segurança ela é cara.
  if (n === 0) {
    const vazio = await page.locator(".empty-state").innerText().catch(() => "");
    check(/filtro/i.test(vazio), `sem ${sev}: estado vazio de FILTRO, não "tudo limpo"`);
  }
}
await page.click('.segmented button:has-text("Toda severidade")');
await page.waitForTimeout(300);
check(soma <= total, `as severidades somam ${soma}, dentro do total ${total}`);

// A busca RESTRINGE; o texto vazio RESTAURA.
await busca("zzz-nao-existe-em-lugar-nenhum-zzz");
check((await cards()) === 0, "busca sem resultado esvazia a lista");
await busca("");
// Limpar a busca volta à PRIMEIRA página — a paginação é reiniciada, e isso é
// o comportamento certo. Por isso a referência é `inicial` (uma página) e não
// `total` (o que estava expandido antes da busca).
const aposLimpar = await cards();
check(
  aposLimpar >= Math.min(inicial, total),
  `limpar a busca restaura a lista (${aposLimpar} de ${total})`
);
await capturar(`12-busca.png`);

// Origem: as partes não passam do todo.
await page.click('.segmented button:has-text("SAST")');
await page.waitForTimeout(400);
const sast = await cards();
await page.click('.segmented button:has-text("Revisão IA")');
await page.waitForTimeout(400);
const ia = await cards();
check(sast + ia <= total, `origem: SAST ${sast} + IA ${ia} <= total ${total}`);
await page.click('.segmented button:has-text("Toda origem")');
await page.waitForTimeout(300);

console.log("\n=== FEAT-01 · ESTADO DO ACHADO ===");
const antes = await page.locator(".segmented button:has-text('Abertos')").innerText();
await page.locator(".finding-list .vuln-card").first().locator('button:has-text("Falso positivo")').click();
await page.waitForTimeout(1000);
const depois = await page.locator(".segmented button:has-text('Abertos')").innerText();
check(antes !== depois, `contador de abertos caiu: "${antes}" -> "${depois}"`);
await page.click('.segmented button:has-text("Resolvidos")');
await page.waitForTimeout(600);
check((await cards()) >= 1, `aba Resolvidos: ${await cards()} achado(s)`);
const riscado = await page.locator(".vuln-card.is-resolved").count();
check(riscado >= 1, "card resolvido recebe estilo próprio");
await capturar(`13-resolvidos.png`);
await page.click('.segmented button:has-text("Abertos")');
await page.waitForTimeout(500);

console.log("\n=== UX-02 + FEAT-02 · MODAL, DIFF E CACHE ===");
let chamadasFix = 0;
page.on("request", (r) => r.url().includes("/api/step4-fix") && chamadasFix++);
await page.click(".segmented button:has-text(\"Todos\")");
await page.waitForTimeout(400);
await busca("");
await capturar(`16-busca-fix.png`);

// ---- A correção guardada é PROCURADA, não presumida ----
//
// Isto dependia de `ARQUIVO_COM_FIX = ".github/workflows/ci.yml"`: um achado
// com correção plantada à mão no banco de quem escreveu a suíte. Em qualquer
// outra base o botão não existe, e o teste morria num timeout de 30 s
// afirmando que a interface estava quebrada quando o que faltava era o DADO.
//
// Agora: havendo correção guardada em algum achado, o modal é exercitado;
// não havendo, o bloco é pulado com o motivo dito em voz alta. Gerar uma
// correção aqui seria uma chamada de IA paga a cada execução da suíte.
const alvo = page.locator('.vuln-card:has(button:has-text("Ver correção"))').first();
const temCorrecaoGuardada = (await alvo.count()) > 0;

if (temCorrecaoGuardada) {
await alvo.locator('button:has-text("Ver correção")').click();
await page.waitForTimeout(2500);

const dialog = page.locator('[role="dialog"]');
check(await dialog.count(), "modal tem role=dialog");
check((await dialog.getAttribute("aria-modal")) === "true", "aria-modal=true");
check(!!(await dialog.getAttribute("aria-labelledby")), "aria-labelledby presente");
check(
  (await page.evaluate(() => document.body.style.overflow)) === "hidden",
  "rolagem do fundo travada"
);
const linhasDiff = await page.locator(".diff-line").count();
const stats = await page.locator(".diff-stats").innerText().catch(() => "");
check(linhasDiff > 0, `diff renderizado: ${linhasDiff} linhas`);
check(/\+\d/.test(stats), `contador: ${stats.replace(/\s+/g, " ").trim()}`);
check(chamadasFix === 1, `${chamadasFix} chamada a /api/step4-fix (correção veio do cache)`);
await capturar(`14-modal-diff.png`);

console.log("\n=== UX-04 · ACESSIBILIDADE ===");
check(
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return !!d && d.contains(document.activeElement);
  }),
  "foco fica dentro do modal ao abrir"
);
// Tab várias vezes não pode escapar do diálogo.
for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
check(
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return !!d && d.contains(document.activeElement);
  }),
  "após 25 Tabs o foco continua preso no modal"
);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
check((await page.locator('[role="dialog"]').count()) === 0, "ESC fecha");
check(
  (await page.evaluate(() => document.body.style.overflow)) !== "hidden",
  "rolagem restaurada ao fechar"
);
} else {
  console.log("  ⚠  nenhum achado com correção guardada — modal, diff, cache e",
    "acessibilidade do modal não foram exercitados");
  console.log("     (gere uma correção pela tela e rode de novo para cobrir este bloco)");
}

console.log("\n=== UX-05 · LOTE PEDE CONFIRMAÇÃO ===");
await busca("");
await page.locator(".vuln-check").first().check();
await page.locator(".vuln-check").nth(1).check();
// O que se afirma é que ABRIR o lote não gasta IA — então a referência é
// quanto já se gastou até aqui, não o literal `1` (que só valia quando o bloco
// do modal, hoje condicional ao dado, tinha rodado antes).
const fixAntesDoLote = chamadasFix;
await page.click('button:has-text("Corrigir")');
await page.waitForTimeout(800);
const txt = await page.locator('[role="dialog"]').innerText();
check(/chamada\(s\) de IA/i.test(txt), "confirma o custo ANTES de gerar");
check(
  chamadasFix === fixAntesDoLote,
  `nenhuma chamada de IA disparada só por abrir o lote (${fixAntesDoLote} antes, ${chamadasFix} depois)`
);
await capturar(`15-lote-confirmacao.png`);

console.log("\n=== ERROS DE JAVASCRIPT ===");
check(erros.length === 0, `${erros.length} erro(s) no console`);
erros.slice(0, 4).forEach((e) => console.log("    ", e.slice(0, 150)));

console.log(`\n${falhas === 0 ? "TUDO OK" : falhas + " FALHA(S)"}`);
await browser.close();
process.exit(falhas ? 1 : 0);
