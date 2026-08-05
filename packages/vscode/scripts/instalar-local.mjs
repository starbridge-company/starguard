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
// Este script faz o que o `--force` não faz: desinstala primeiro, confere que
// nenhuma pasta sobrou, e só então instala. Uma versão de cada vez.
// ============================================================
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ID = "starbridge.starguard-vscode";
const VSIX = "starguard.vsix";
const PASTA = join(homedir(), ".vscode", "extensions");

/** O `code` da máquina. Falha visível é melhor que instalação pela metade. */
function code(...args) {
  return execFileSync(process.platform === "win32" ? "code.cmd" : "code", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

console.log(`[vsix] desinstalando ${ID}…`);
try {
  code("--uninstall-extension", ID);
} catch {
  // Não estava instalada. É o caso normal numa máquina nova, e não é erro.
  console.log("[vsix] não havia nada instalado.");
}

// O VS Code marca as pastas como obsoletas e só as apaga ao reiniciar. Se
// ficarem, a próxima instalação volta a conviver com elas — que é exatamente
// o que produziu a duplicação. Apagamos agora.
if (existsSync(PASTA)) {
  const restos = readdirSync(PASTA).filter((n) => n.startsWith(`${ID}-`));
  for (const r of restos) {
    try {
      rmSync(join(PASTA, r), { recursive: true, force: true });
      console.log(`[vsix] pasta removida: ${r}`);
    } catch (e) {
      // Arquivo travado pelo editor aberto. Avisar é melhor que seguir e
      // deixar a duplicação voltar sem ninguém entender por quê.
      console.warn(`[vsix] NÃO consegui remover ${r}: ${e.message}`);
      console.warn("[vsix] feche o VS Code e rode de novo.");
    }
  }
  const obsoleto = join(PASTA, ".obsolete");
  if (existsSync(obsoleto)) writeFileSync(obsoleto, "{}");
}

console.log(`[vsix] instalando ${VSIX}…`);
code("--install-extension", VSIX);
console.log("[vsix] pronto. Recarregue a janela do VS Code.");
