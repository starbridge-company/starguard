// ============================================================
// O que toda suíte de navegador precisa antes de começar.
//
// Existe por um motivo específico: duas suítes carregavam o id de uma análise
// **escrito no código** —
//
//   const ID = "8a9feefe-cd91-4dcf-9584-d4773905678c";
//
// — que só existia no banco de quem as escreveu. Num banco novo (o que o
// próprio `e2e/README.md` manda criar) a tela abria vazia, o `page.click` de
// uma aba inexistente estourava em 30 s e a mensagem era
// `Timeout waiting for locator('button:has-text("Correções")')`: um erro que
// não diz nada sobre a causa e manda procurar bug na interface.
//
// O efeito prático é que as duas suítes eram **inexecutáveis por qualquer
// pessoa** que não fosse a autora — e é por isso que a auditoria acumulou
// "nada foi visto em navegador" por tantos sprints. Um teste que ninguém
// consegue rodar não protege nada.
//
// Aqui a análise é DESCOBERTA: pergunta-se ao servidor qual existe. Se não
// houver nenhuma, a suíte diz o que fazer e sai com um código próprio, em vez
// de falhar como se a aplicação estivesse quebrada.
// ============================================================

export const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3020";
export const EMAIL = process.env.E2E_EMAIL || "admin@starguard.local";
export const SENHA = process.env.E2E_PASSWORD || "StarGuard!2026";

/**
 * Faz login pela tela — é o caminho que uma pessoa percorre — e **fixa o
 * idioma** antes de qualquer asserção.
 *
 * O idioma precisa ser fixado, e a razão é um defeito que custou uma
 * investigação inteira: o login grava em `sg_locale` a preferência SALVA NA
 * CONTA (`app/api/auth/login/route.ts`), e a suíte `idioma.mjs` termina o
 * roteiro dela em inglês — deixando a conta em inglês. As suítes seguintes,
 * que procuram rótulos em português ("Correções"), passavam a esperar 30 s por
 * um botão que existia escrito "Fixes".
 *
 * O sintoma não tinha nada a ver com a causa: `Timeout waiting for
 * locator('button:has-text("Correções")')` parece bug de interface, e o que
 * havia era uma suíte deixando estado para a outra. Pior: o resultado dependia
 * da ORDEM alfabética dos arquivos e do que tivesse rodado antes na mesma base.
 *
 * Fixar aqui resolve na origem — o cookie tem precedência sobre a conta em
 * `getLocale()`, então basta escrevê-lo depois do login.
 */
export async function entrar(page, locale = "pt-BR") {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  await fixarIdioma(page, locale);
}

/** Escreve `sg_locale` e recarrega. Cookie vence a preferência da conta. */
export async function fixarIdioma(page, locale = "pt-BR") {
  await page.context().addCookies([
    // `url` SOZINHO: o Playwright recusa `url` junto de `path`/`domain`.
    { name: "sg_locale", value: locale, url: BASE },
  ]);
  await page.reload({ waitUntil: "networkidle" });
}

/**
 * O id de uma análise com achados, para as telas que precisam de uma.
 *
 * `E2E_ANALYSIS_ID` tem precedência: quem quer fixar uma análise específica
 * continua podendo. Sem ela, pega a mais recente que o servidor listar.
 */
export async function acharAnalise(page) {
  if (process.env.E2E_ANALYSIS_ID) return process.env.E2E_ANALYSIS_ID;

  const lista = await page.evaluate(async () => {
    const r = await fetch("/api/analyses?page=1", { credentials: "include" });
    if (!r.ok) return null;
    return r.json();
  });

  const itens = lista?.items ?? lista?.analyses ?? lista?.rows ?? [];
  // A que tiver achados é a útil: as telas de Correções e Dependências não
  // existem numa análise vazia, e falhar nelas por isso é ruído.
  const comAchados = itens.find((a) => (a.metrics?.totalFindings ?? a.totalFindings ?? 0) > 0);
  return (comAchados ?? itens[0])?.id;
}

/** Sai com uma mensagem que diz o que fazer, e não com um timeout mudo. */
export function semAnalise() {
  console.log("\n⚠  Nenhuma análise no banco — esta suíte precisa de uma para abrir a tela.");
  console.log("   Crie uma pelo painel (ou por POST /api/analyze) e rode de novo.");
  console.log("   Para fixar uma específica: E2E_ANALYSIS_ID=<uuid> npm run test:e2e\n");
  // 0 e não 1: a suíte não FALHOU, ela não tinha o que exercitar. Marcar como
  // falha treinaria quem lê a saída a ignorar vermelho.
  process.exit(0);
}
