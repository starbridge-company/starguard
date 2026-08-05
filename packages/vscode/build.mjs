// ============================================================
// Empacotamento da extensão.
//
// Por que um bundler aqui, se o CLI não precisou: o extension host do VS Code
// carrega a extensão como CommonJS, e `@starguard/core` é ESM puro. Sem
// conversão, o `require` do host não consegue carregar o motor — não é
// preferência de empacotamento, é o único jeito de os dois se falarem.
//
// É também o que a documentação do VS Code recomenda por outro motivo:
// a extensão publicada vira UM arquivo, sem `node_modules` junto. Para uma
// ferramenta de segurança isso importa — não se distribui uma árvore de
// terceiros para dentro do editor de ninguém.
//
// `esbuild` é dependência de DESENVOLVIMENTO: não vai no pacote publicado, e
// não muda a decisão de manter o produto sem dependência de runtime.
// ============================================================
import { build } from "esbuild";
import { rm } from "node:fs/promises";

const producao = process.argv.includes("--producao");

// Limpa antes de gerar. O `dist` já carregou sobras de um build anterior feito
// com `tsc` (um `findings.js` solto), e elas ENTRARAM no `.vsix` — arquivo
// morto distribuído para dentro do editor de alguém. Como o bundle é um
// arquivo só, tudo que sobreviver a esta linha é lixo.
await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  // O host é CommonJS. O motor é ESM. A conversão acontece aqui.
  format: "cjs",
  target: "node20",
  sourcemap: !producao,
  minify: producao,
  external: [
    // Fornecido pelo próprio editor, nunca empacotado.
    "vscode",
    // Traz binário nativo e faz spawn de subprocesso — não sobrevive a um
    // bundle. E não faz falta: o engine de agente exige repositório REMOTO
    // (ver `fix/code.ts`), e a extensão trabalha sobre o disco local. Se um dia
    // for chamado sem estar instalado, o `try/catch` de `generateFix` cai para
    // a Claude API, que é o caminho que a extensão já usa.
    "@anthropic-ai/claude-agent-sdk",
  ],
  logLevel: "info",
});
