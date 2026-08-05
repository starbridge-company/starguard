// ============================================================
// A fronteira do núcleo — AUDITORIA.md#ARQ-13.
//
// O motor serve três produtos: o painel web (Next), o terminal e a extensão do
// VS Code. Um `import "next/..."` ou um `import { db }` que entre aqui só
// falha quando alguém roda `starguard` no terminal — longe de quem escreveu, e
// depois de o pacote já ter sido publicado. É o mesmo tipo de erro que o
// CLAUDE.md já registra sobre importar `lib/i18n/index.tsx` do servidor: não
// quebra tipo nem build, só runtime.
//
// Por isso a fronteira é verificada por teste, e não por acordo.
// ============================================================
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Pacotes que o núcleo NÃO pode conhecer, e por quê. */
const PROIBIDOS: { re: RegExp; motivo: string }[] = [
  { re: /^next(\/|$)/, motivo: "o terminal e o VS Code não têm Next" },
  { re: /^server-only$/, motivo: "marcador do Next; fora dele não resolve" },
  { re: /^react(-dom)?(\/|$)/, motivo: "o motor não desenha tela" },
  { re: /^drizzle-orm(\/|$)/, motivo: "persistência é sink, não motor" },
  { re: /^pg$/, motivo: "o CLI não pode exigir um Postgres de pé" },
  { re: /^@\//, motivo: "alias do app web; o núcleo não pode alcançá-lo" },
  { re: /^zod$/, motivo: "validação de entrada HTTP é do app" },
];

async function arquivos(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await arquivos(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Especificadores de `import`/`export … from`/`import()` de um arquivo. */
function especificadores(src: string): string[] {
  const out: string[] = [];
  const RE = /(?:from|import)\s*\(?\s*(["'])([^"']+)\1/g;
  for (let m; (m = RE.exec(src)); ) out.push(m[2]!);
  return out;
}

describe("o núcleo não conhece o app web", () => {
  it("nenhum arquivo importa Next, React, Drizzle, pg, zod ou o alias `@/`", async () => {
    const violacoes: string[] = [];
    for (const file of await arquivos(SRC)) {
      const src = await readFile(file, "utf8");
      for (const spec of especificadores(src)) {
        const proibido = PROIBIDOS.find((p) => p.re.test(spec));
        if (proibido) {
          violacoes.push(
            `${relative(SRC, file)} importa "${spec}" — ${proibido.motivo}`
          );
        }
      }
    }
    expect(violacoes).toEqual([]);
  });

  it("todo import relativo é SEM extensão", async () => {
    // O Turbopack (que o Next 16 usa em dev e no build) não resolve `./x.js`
    // para `x.ts` e não tem como ser configurado para isso. As extensões que o
    // ESM do Node exige são acrescentadas na emissão, por
    // `scripts/add-extensions.mjs`. Um `.js` que escape para o fonte quebra o
    // build do painel — e só ali, o que torna a causa difícil de achar.
    const violacoes: string[] = [];
    for (const file of await arquivos(SRC)) {
      const src = await readFile(file, "utf8");
      for (const spec of especificadores(src)) {
        if (spec.startsWith(".") && /\.(js|ts)$/.test(spec)) {
          violacoes.push(`${relative(SRC, file)} importa "${spec}"`);
        }
      }
    }
    expect(violacoes).toEqual([]);
  });
});

describe("o que pode ser importado do NAVEGADOR não puxa Node", () => {
  // O app importa `@/types`, `@/lib/i18n/*`, `@/lib/dedup`, `@/lib/constants` e
  // `@/lib/deps-fix` de dentro de componentes `"use client"`. Se qualquer um
  // deles alcançar `node:child_process`, o bundle do navegador quebra.
  const SEGUROS = [
    "types.ts",
    "contracts.ts",
    "constants.ts",
    "dedup.ts",
    "repo-url.ts",
    "github-auth.ts",
    "i18n/config.ts",
    "i18n/messages.ts",
    "i18n/translate.ts",
    "i18n/index.ts",
    "fix/deps.ts",
  ];

  for (const rel of SEGUROS) {
    it(`${rel} não alcança nenhum módulo do Node`, async () => {
      const vistos = new Set<string>();
      const pendentes = [rel];
      const culpados: string[] = [];

      while (pendentes.length) {
        const atual = pendentes.pop()!;
        if (vistos.has(atual)) continue;
        vistos.add(atual);

        const src = await readFile(join(SRC, atual), "utf8").catch(() => null);
        if (src === null) continue;

        for (const spec of especificadores(src)) {
          if (/^node:/.test(spec)) {
            culpados.push(`${atual} → ${spec}`);
            continue;
          }
          if (!spec.startsWith(".")) continue;
          // Resolve o relativo a partir do diretório do arquivo atual.
          const base = atual.includes("/") ? atual.slice(0, atual.lastIndexOf("/")) : "";
          const juntos = base ? `${base}/${spec}` : spec;
          const partes: string[] = [];
          for (const p of juntos.split("/")) {
            if (p === "." || p === "") continue;
            if (p === "..") partes.pop();
            else partes.push(p);
          }
          pendentes.push(`${partes.join("/")}.ts`, `${partes.join("/")}/index.ts`);
        }
      }

      expect(culpados).toEqual([]);
    });
  }
});
