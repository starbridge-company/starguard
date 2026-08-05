// ============================================================
// Instala a extensão nesta máquina, SUBSTITUINDO a que estiver lá.
//
// Existe por um estrago concreto. Durante o desenvolvimento a extensão foi
// instalada várias vezes com `code --install-extension … --force`, e o
// `--force` **não remove a versão anterior**: cada uma deixou a sua pasta em
// `~/.vscode/extensions`. O VS Code passou a enxergar quatro instalações do
// mesmo id e a MESCLAR as contribuições das quatro — o painel lateral apareceu
// com a tela de boas-vindas repetida, botão de entrar e tudo.
//
// O sintoma engana porque parece bug da extensão. Não é: o `.vsix` está certo,
// o manifesto declara uma contribuição só. É higiene de instalação.
//
// ---- A ordem importa, e a primeira versão deste script errou nela ----
//
// Ela apagava as pastas logo depois de mandar desinstalar, sem conferir se a
// desinstalação tinha valido. Quando o `code` falhou, o resultado foi o pior
// de todos: pasta nenhuma no disco e o registro ainda apontando para uma
// versão — a máquina ficou sem extensão E sem como reinstalar por cima.
//
// A ordem certa é: desinstalar, INSTALAR, e só então limpar o que sobrou.
// Assim, qualquer passo que falhe deixa a máquina num estado utilizável.
// ============================================================
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ID = "starbridge.starguard-vscode";
const VSIX = "starguard.vsix";
const PASTA = join(homedir(), ".vscode", "extensions");
const versaoAtual = JSON.parse(readFileSync("package.json", "utf8")).version;

/**
 * O `code` da máquina. Devolve `{ erro }` em vez de explodir.
 *
 * `shell: true` no Windows não é preferência: desde a correção da
 * CVE-2024-27980, o Node recusa `execFile` direto num `.cmd` e devolve
 * `EINVAL`. Sem isto o script falha em toda máquina Windows — que é onde ele
 * roda. Os argumentos são literais deste arquivo mais o nome fixo do `.vsix`;
 * nada vem de fora, então o shell não abre caminho para injeção.
 */
function code(...args) {
  const win = process.platform === "win32";
  try {
    return execFileSync(win ? "code.cmd" : "code", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: win,
    });
  } catch (e) {
    return { erro: e.message };
  }
}

// ---- 1. Desinstalar ----
console.log(`[vsix] desinstalando ${ID}…`);
const saidaUninstall = code("--uninstall-extension", ID);
if (saidaUninstall?.erro) {
  // Não é fatal: pode não haver nada instalado, que é o caso normal numa
  // máquina nova. Seguimos — o install adiante é que decide.
  console.log("[vsix] nada a desinstalar (ou o editor recusou).");
}

// ---- 2. Instalar ----
// Antes de qualquer limpeza. Se este passo falhar, a máquina ainda tem o que
// tinha; se ele passar, existe uma instalação boa para a limpeza preservar.
console.log(`[vsix] instalando ${VSIX} (v${versaoAtual})…`);
const saidaInstall = code("--install-extension", VSIX);
if (saidaInstall?.erro) {
  console.error(`[vsix] FALHOU a instalação: ${saidaInstall.erro}`);
  console.error("[vsix] feche o VS Code e rode de novo.");
  process.exit(1);
}

// ---- 3. Limpar o que sobrou ----
// Só as pastas de OUTRAS versões. A da versão recém-instalada é preservada
// explicitamente — apagá-la é o erro que este script existe para não cometer.
const atual = `${ID}-${versaoAtual}`;
if (existsSync(PASTA)) {
  const restos = readdirSync(PASTA).filter((n) => n.startsWith(`${ID}-`) && n !== atual);
  for (const r of restos) {
    try {
      rmSync(join(PASTA, r), { recursive: true, force: true });
      console.log(`[vsix] versão antiga removida: ${r}`);
    } catch (e) {
      // Arquivo travado pelo editor aberto. Avisar é melhor que seguir calado
      // e deixar a duplicação voltar sem ninguém entender por quê.
      console.warn(`[vsix] NÃO consegui remover ${r}: ${e.message}`);
      console.warn("[vsix] feche o VS Code e rode de novo.");
    }
  }
  const obsoleto = join(PASTA, ".obsolete");
  if (existsSync(obsoleto)) writeFileSync(obsoleto, "{}");
}

// ---- 4. Conferir ----
// Registro e disco precisam concordar. Divergência aqui é exatamente o que
// produz "instalei mas continua a versão antiga".
const noDisco = existsSync(PASTA)
  ? readdirSync(PASTA).filter((n) => n.startsWith(`${ID}-`))
  : [];
console.log(`[vsix] no disco: ${noDisco.join(", ") || "(nada)"}`);
if (noDisco.length !== 1 || noDisco[0] !== atual) {
  console.warn(`[vsix] ATENÇÃO: esperava só ${atual}. Feche o VS Code e rode de novo.`);
  process.exit(1);
}
console.log("[vsix] pronto. Recarregue a janela do VS Code.");
