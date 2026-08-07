import { chromium } from "playwright";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3020";
// Diretório de sessão de outra máquina, que não existe mais. Sem `E2E_SHOTS`
// não se captura nada: a suíte afirma pelo DOM, a imagem é para depurar.
const OUT = process.env.E2E_SHOTS || "";
let falhas = 0;
const check = (c, m) => { if (!c) falhas++; console.log(`  ${c ? "✓" : "✗ FALHOU"}  ${m}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "en-US" });
const page = await ctx.newPage();

/** Captura só quando `E2E_SHOTS` aponta um diretório. A afirmação é do DOM. */
const capturar = async (nome) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${nome}` });
};
const erros = [];
page.on("pageerror", (e) => erros.push(String(e)));
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

console.log("\n=== 1. PRIMEIRA VISITA COM NAVEGADOR EM INGLÊS ===");
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const langAuto = await page.getAttribute("html", "lang");
const submitAuto = await page.locator('button[type="submit"]').innerText();
check(langAuto === "en", `<html lang> segue o Accept-Language: "${langAuto}"`);
check(/sign in/i.test(submitAuto), `botão em inglês sem configurar nada: "${submitAuto.trim()}"`);
await capturar(`30-login-en.png`);

console.log("\n=== 2. LOGIN E NAVEGAÇÃO EM INGLÊS ===");
await page.fill("#email", "admin@starguard.local");
await page.fill("#password", "StarGuard!2026");
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/`);
const nav = await page.locator(".sidebar-nav").innerText();
check(/New analysis/i.test(nav) && /Account/i.test(nav), `menu traduzido: ${nav.split("\n").slice(0,3).join(" · ")}`);
const logout = await page.locator(".sidebar-actions").innerText();
check(/Sign out/i.test(logout), "ações do rodapé traduzidas");
await capturar(`31-home-en.png`);

console.log("\n=== 3. TROCA EXPLÍCITA PARA PORTUGUÊS ===");
await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
await capturar(`32-conta-en.png`);
await page.click('.segmented button:has-text("Português")');
await page.waitForTimeout(2500);
const langPt = await page.getAttribute("html", "lang");
const navPt = await page.locator(".sidebar-nav").innerText();
check(langPt === "pt-BR", `<html lang> mudou para "${langPt}"`);
check(/Nova análise/i.test(navPt), "menu voltou ao português");
const cookie = (await ctx.cookies()).find((c) => c.name === "sg_locale");
check(cookie?.value === "pt-BR", `escolha persistida no cookie: ${cookie?.value}`);
await capturar(`33-conta-pt.png`);

console.log("\n=== 4. A ESCOLHA SOBREVIVE À RECARGA ===");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
check((await page.getAttribute("html", "lang")) === "pt-BR", "continua em português após navegar");

console.log("\n=== 5. VOLTA PARA INGLÊS E CONFERE A TELA DE RESULTADOS ===");
await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
await page.click('.segmented button:has-text("English")');
await page.waitForTimeout(2500);
const en2 = await page.locator(".sidebar-nav").innerText();
check(/Analyses/i.test(en2), "menu em inglês de novo");

console.log("\n=== ERROS DE JAVASCRIPT ===");
check(erros.length === 0, `${erros.length} erro(s)`);
erros.slice(0, 4).forEach((e) => console.log("   ", e.slice(0, 140)));
console.log(`\n${falhas === 0 ? "TUDO OK" : falhas + " FALHA(S)"}`);
await browser.close();
process.exit(falhas ? 1 : 0);
