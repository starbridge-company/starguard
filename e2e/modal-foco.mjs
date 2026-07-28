// BUG-23 — o modal roubava o foco a cada tecla digitada.
//
// O efeito de montagem do Modal dependia de `requestClose`, cuja identidade
// muda a cada render porque `confirmClose` chega como arrow inline. Digitar um
// caractere re-rodava o efeito, que devolvia o foco ao primeiro focável do
// diálogo — o InfoTip do cabeçalho, que abre o balão no `onFocus`.
//
// Antes da correção: o campo fica com 1 caractere e o balão de ajuda aparece.
// Só o navegador revela isto: compila, tipa e passa no lint.
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3020";
let falhas = 0;
const check = (c, m) => { if (!c) falhas++; console.log(`  ${c ? "✓" : "✗ FALHOU"}  ${m}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill("#email", "admin@starguard.local");
await page.fill("#password", "StarGuard!2026");
await page.click('button[type="submit"]');
await page.waitForURL(`${BASE}/`);
await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });

console.log("\n=== BUG-23 · digitar no formulário de novo usuário ===");
await page.click(".header-actions button.button.primary");
await page.waitForSelector('[role="dialog"]');

// 1. Abrir o modal não pode escancarar o pop-up de ajuda do cabeçalho.
const focoInicial = await page.evaluate(() => document.activeElement?.id || "");
check(focoInicial === "nu-name", `foco inicial vai para o primeiro campo (foi para "${focoInicial}")`);
check(
  (await page.locator('[role="tooltip"]').count()) === 0,
  "o balão do InfoTip NÃO abre sozinho ao abrir o modal"
);

// 2. Digitar tecla a tecla (um render por tecla — é isso que disparava o bug).
const NOME = "Maria Silva";
await page.locator("#nu-name").click();
await page.locator("#nu-name").pressSequentially(NOME, { delay: 30 });
const nome = await page.inputValue("#nu-name");
check(nome === NOME, `o nome inteiro entrou no campo: "${nome}"`);
check(
  (await page.evaluate(() => document.activeElement?.id || "")) === "nu-name",
  "o cursor permaneceu no campo enquanto se digitava"
);
check(
  (await page.locator('[role="tooltip"]').count()) === 0,
  "nenhum pop-up de ajuda roubou o foco durante a digitação"
);

// 3. Os outros campos, inclusive os de senha (autoComplete diferente).
const EMAIL = "maria@exemplo.com";
await page.locator("#nu-email").click();
await page.locator("#nu-email").pressSequentially(EMAIL, { delay: 20 });
await page.locator("#nu-password").click();
await page.locator("#nu-password").pressSequentially("SenhaForte!2026", { delay: 20 });
check((await page.inputValue("#nu-email")) === EMAIL, `e-mail inteiro: "${await page.inputValue("#nu-email")}"`);
check((await page.inputValue("#nu-password")).length === 15, "senha inteira (15 caracteres)");
check(
  await page.locator('button[type="submit"]').isEnabled(),
  "com os três campos preenchidos, o botão Criar habilita"
);

// 4. O Picker de papel continua funcionando (não é <select> nativo).
await page.click("#nu-role");
await page.waitForSelector('[role="listbox"]');
await page.click('[role="option"]:has-text("Superadmin")');
check(
  /superadmin/i.test(await page.locator("#nu-role .flt-trigger-label").innerText()),
  "o Picker de papel troca o valor"
);

// 5. A rolagem da página volta ao fechar. Não era isto que quebrava antes (a
//    medição refutou a suposição), mas agora a restauração vive num efeito de
//    montagem: se alguém devolver dependências a ele, é aqui que vaza.
page.once("dialog", (d) => d.accept()); // confirmação de descarte (formulário sujo)
await page.click(".modal-close");
await page.waitForSelector('[role="dialog"]', { state: "detached" });
const overflow = await page.evaluate(() => document.body.style.overflow);
check(overflow !== "hidden", `a rolagem da página foi destravada (overflow: "${overflow}")`);

console.log(`\n${falhas === 0 ? "TUDO OK" : falhas + " FALHA(S)"}`);
await browser.close();
process.exit(falhas ? 1 : 0);
