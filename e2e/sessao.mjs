import { chromium } from "playwright";
// A análise é DESCOBERTA, não escrita no código: ver o cabeçalho de `comum.mjs`.
import { BASE, acharAnalise, entrar, semAnalise } from "./comum.mjs";
let falhas = 0;
const check = (c, m) => { if (!c) falhas++; console.log(`  ${c ? "✓" : "✗ FALHOU"}  ${m}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const reqs = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/")) reqs.push(`${r.status()} ${u.replace(BASE, "")}`);
});

// `entrar` fixa o idioma junto: sem isso a suíte depende do que a `idioma.mjs`
// tiver deixado salvo na conta. Ver o cabeçalho de `comum.mjs`.
await entrar(page);

const ID = await acharAnalise(page);
if (!ID) semAnalise();
await page.goto(`${BASE}/results/${ID}`, { waitUntil: "networkidle" });
await page.click('button:has-text("Correções")');
await page.waitForTimeout(1000);

console.log("\n=== BUG-01 · o access token expira no meio do trabalho ===");
// Simula os 15 minutos passando: remove SÓ o access token, mantendo o refresh.
const antes = await ctx.cookies();
await ctx.clearCookies();
await ctx.addCookies(antes.filter((c) => c.name !== "sg_at"));
const agora = await ctx.cookies();
check(!agora.find((c) => c.name === "sg_at"), "cookie de acesso removido (sessão 'expirada')");
check(!!agora.find((c) => c.name === "sg_rt"), "refresh token preservado");

reqs.length = 0;
// Ação normal do usuário: marcar um achado. Dispara PATCH -> deve dar 401,
// renovar sozinho e repetir a requisição, sem passar pelo login.
await page.locator(".finding-list .vuln-card").first().locator('button:has-text("Já corrigi")').click();
await page.waitForTimeout(2500);

const teve401 = reqs.some((r) => r.startsWith("401"));
const teveRefresh = reqs.some((r) => r.includes("/api/auth/refresh") && r.startsWith("200"));
const patchOk = reqs.some((r) => r.startsWith("200") && r.includes("/api/findings/"));
console.log("  requisições:", reqs.join(" | "));
check(teve401, "a requisição original tomou 401 (token expirado)");
check(teveRefresh, "o cliente chamou /api/auth/refresh sozinho");
check(patchOk, "a requisição original foi REFEITA com sucesso");
check(!page.url().includes("/login"), "o usuário NÃO foi expulso para a tela de login");

console.log(`\n${falhas === 0 ? "TUDO OK" : falhas + " FALHA(S)"}`);
await browser.close();
process.exit(falhas ? 1 : 0);
