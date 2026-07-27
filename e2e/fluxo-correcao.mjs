import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3020";
const OUT = "C:/Users/Nelson/AppData/Local/Temp/claude/c--Users-Nelson-OneDrive-Projetos-starguard/dc4fad7c-7a2d-4b9b-bde4-efbf334544c5/scratchpad/shots";
const ID = "8a9feefe-cd91-4dcf-9584-d4773905678c";
// Achado que tem correção guardada no banco (plantada para o teste).
const ARQUIVO_COM_FIX = ".github/workflows/ci.yml";

let falhas = 0;
const check = (c, m) => {
  if (!c) falhas++;
  console.log(`  ${c ? "✓" : "✗ FALHOU"}  ${m}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const erros = [];
page.on("pageerror", (e) => erros.push(String(e)));
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "admin@starguard.local");
await page.fill("#password", "StarGuard!2026");
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/results/${ID}`, { waitUntil: "networkidle" });
await page.click('button:has-text("Correções")');
await page.waitForTimeout(1200);

const cards = () => page.locator(".finding-list .vuln-card").count();
const busca = async (t) => {
  await page.fill(".flt-search-input", t);
  await page.waitForTimeout(500);
};

console.log("\n=== UX-01 · FILTROS E PAGINAÇÃO ===");
const inicial = await cards();
check(inicial === 25, `renderiza ${inicial} cards por vez (44 no total)`);
await page.click('button:has-text("Mostrar mais")');
await page.waitForTimeout(400);
const todos = await cards();
check(todos >= 42, `Mostrar mais completa para ${todos}`);

// Este repositório tem 3 achados de severidade Alta e nenhum Crítico.
await page.click(String.fromCharCode(46)+"segmented button:has-text(\"Baixa\")");
await page.waitForTimeout(400);
check((await cards()) === 3, `filtro Baixa: ${await cards()} cards (esperado 3 — o repo nao tem criticos nem altos no codigo)`);
await page.screenshot({ path: `${OUT}/11-filtro-severidade.png` });

await page.click('.segmented button:has-text("Crítica")');
await page.waitForTimeout(400);
const vazio = await page.locator(".empty-state").innerText().catch(() => "");
check(
  (await cards()) === 0 && /filtros atuais/i.test(vazio),
  "sem achados críticos: mostra estado vazio de FILTRO (não '🎉 tudo limpo')"
);

await page.click('.segmented button:has-text("Toda severidade")');
await page.waitForTimeout(300);
await busca("package-dependencies");
check((await cards()) === 19, `busca por regra: ${await cards()} cards (esperado 19)`);
await page.screenshot({ path: `${OUT}/12-busca.png` });

await busca("");
await page.click('.segmented button:has-text("SAST")');
await page.waitForTimeout(400);
const sast = await cards();
await page.click('.segmented button:has-text("Revisão IA")');
await page.waitForTimeout(400);
const ia = await cards();
check(sast === 25 && ia === 0, `filtro por origem: SAST ${sast} · IA ${ia} (sem key de IA)`);
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
await page.screenshot({ path: `${OUT}/13-resolvidos.png` });
await page.click('.segmented button:has-text("Abertos")');
await page.waitForTimeout(500);

console.log("\n=== UX-02 + FEAT-02 · MODAL, DIFF E CACHE ===");
let chamadasFix = 0;
page.on("request", (r) => r.url().includes("/api/step4-fix") && chamadasFix++);
await page.click(".segmented button:has-text(\"Todos\")");
await page.waitForTimeout(400);
await busca(ARQUIVO_COM_FIX);
await page.screenshot({ path: `${OUT}/16-busca-fix.png` });
const alvo = page.locator('.vuln-card:has(button:has-text("Ver correção"))').first();
check(await alvo.count(), "card com correção guardada mostra 'Ver correção'");
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
await page.screenshot({ path: `${OUT}/14-modal-diff.png` });

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

console.log("\n=== UX-05 · LOTE PEDE CONFIRMAÇÃO ===");
await busca("");
await page.locator(".vuln-check").first().check();
await page.locator(".vuln-check").nth(1).check();
await page.click('button:has-text("Corrigir")');
await page.waitForTimeout(800);
const txt = await page.locator('[role="dialog"]').innerText();
check(/chamada\(s\) de IA/i.test(txt), "confirma o custo ANTES de gerar");
check(chamadasFix === 1, "nenhuma chamada de IA disparada só por abrir o lote");
await page.screenshot({ path: `${OUT}/15-lote-confirmacao.png` });

console.log("\n=== ERROS DE JAVASCRIPT ===");
check(erros.length === 0, `${erros.length} erro(s) no console`);
erros.slice(0, 4).forEach((e) => console.log("    ", e.slice(0, 150)));

console.log(`\n${falhas === 0 ? "TUDO OK" : falhas + " FALHA(S)"}`);
await browser.close();
process.exit(falhas ? 1 : 0);
