// ============================================================
// Acrescenta a extensão `.js` aos imports relativos do `dist`.
//
// Por que este passo existe: o CÓDIGO-FONTE do núcleo importa sem extensão
// (`from "./config"`) porque é assim que o Turbopack — que o Next 16 usa em
// desenvolvimento e no build de produção — consegue resolver `.ts`. Ele não
// tem `extensionAlias`, então um `./config.js` no fonte simplesmente não é
// encontrado.
//
// Só que o `dist` é ESM de verdade, rodando no Node do terminal e no extension
// host do VS Code, e ali `./config` sem extensão é `ERR_MODULE_NOT_FOUND`. As
// duas exigências são reais e opostas; a saída é atender uma no fonte e a
// outra na emissão.
//
// Sem dependência nova, de propósito: um bundler resolveria isto, mas
// acrescentaria uma cadeia de terceiros a uma ferramenta de segurança para
// fazer o trabalho de trinta linhas.
// ============================================================
// `--dir <caminho>` deixa o mesmo script servir os outros pacotes do
// repositório (o CLI tem o mesmo dilema), em vez de cada um manter a sua cópia.
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const flagDir = process.argv.indexOf("--dir");
const DIST =
  flagDir > -1 && process.argv[flagDir + 1]
    ? // Relativo a QUEM CHAMOU, não ao script: quem passa `--dir ./dist` está
      // pensando no próprio pacote, não em onde este arquivo mora.
      resolve(process.cwd(), process.argv[flagDir + 1])
    : resolve(import.meta.dirname, "..", "dist");

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".js") || e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

async function ehDiretorio(p) {
  return stat(p)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

let alterados = 0;
for (const file of await walk(DIST)) {
  const src = await readFile(file, "utf8");
  const base = dirname(file);
  const pedacos = [];
  let ultimo = 0;

  // `from "./x"`, `import("./x")` e `export … from "./x"` — os três aparecem
  // no que o tsc emite (o `import()` dinâmico é usado para carregar o agente e
  // o Octokit sob demanda).
  const RE = /((?:from|import)\s*\(?\s*)(["'])(\.[^"']*)\2/g;
  for (let m; (m = RE.exec(src)); ) {
    const [todo, kw, aspas, spec] = m;
    let novo = spec;
    if (!/\.(js|json|css)$/.test(spec)) {
      // Import de diretório vira o `index` dele — é o que o resolvedor do
      // bundler fazia implicitamente e o Node não faz.
      novo = (await ehDiretorio(join(base, spec))) ? `${spec}/index.js` : `${spec}.js`;
    }
    pedacos.push(src.slice(ultimo, m.index), kw + aspas + novo + aspas);
    ultimo = m.index + todo.length;
  }
  if (!pedacos.length) continue;

  pedacos.push(src.slice(ultimo));
  const out = pedacos.join("");
  if (out !== src) {
    await writeFile(file, out);
    alterados++;
  }
}

console.log(`[core] extensões acrescentadas em ${alterados} arquivo(s) do dist`);
