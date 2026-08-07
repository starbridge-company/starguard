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

/**
 * Tira os comentários antes de procurar imports.
 *
 * Sem isto, uma frase de comentário que CITE um import é lida como import de
 * verdade — e num código onde os comentários explicam por que tal módulo não
 * pode ser importado de tal lugar, é justamente o arquivo mais bem documentado
 * que passa a falhar o teste. Aconteceu aqui.
 *
 * O `[^:]` antes de `//` preserva URLs dentro de strings (`https://…`), que de
 * outro modo seriam truncadas no meio e poderiam esconder um import na mesma
 * linha.
 */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Especificadores de `import`/`export … from`/`import()` de um arquivo. */
function especificadores(src: string): string[] {
  const out: string[] = [];
  const RE = /(?:from|import)\s*\(?\s*(["'])([^"']+)\1/g;
  for (let m; (m = RE.exec(semComentarios(src))); ) out.push(m[2]!);
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

// ============================================================
// A SEGUNDA fronteira: o que o Edge runtime consegue carregar.
//
// A primeira fronteira olha para fora — o núcleo não pode conhecer o app. Esta
// olha para dentro: **nem todo módulo do núcleo pode ser importado de todo
// lugar**, e a diferença derrubou o painel inteiro.
//
// O que aconteceu: `sastJobs()` nasceu em `config.ts` e precisa ler o cgroup,
// que mora em `container.ts` (`node:fs`, `node:os`). Só que `config.ts` é
// reexportado por `lib/config.ts`, que o `middleware.ts` importa — e o
// middleware roda no **Edge runtime**. O empacotador puxa o grafo inteiro, o
// middleware não compila, e um middleware que não compila responde **404 em
// TODAS as rotas**. Não uma rota: o site.
//
// O que torna isso perigoso é que nada avisa antes: `tsc`, ESLint e `npm test`
// passam os três, porque nenhum deles sabe o que é o Edge runtime. Só o
// `next build` reclama — e a mensagem fala de `node:fs`, não do middleware.
//
// Por isso a regra vira teste, do mesmo jeito e pelo mesmo motivo que a
// primeira: um acordo que só o Next verifica é um acordo que ninguém verifica.
// ============================================================

/**
 * Módulos que o EDGE precisa conseguir carregar, com quem os arrasta para lá.
 *
 * Curta de propósito. Não é "o que seria bom manter leve": é a lista do que o
 * `middleware.ts` alcança hoje, e cada entrada tem um caminho de import real
 * atrás dela.
 */
const RAIZES_EDGE: { arquivo: string; porque: string }[] = [
  { arquivo: "config.ts", porque: "lib/config.ts -> middleware.ts" },
  { arquivo: "types.ts", porque: "arrastado por config.ts" },
  { arquivo: "i18n/config.ts", porque: "o middleware resolve o idioma" },
  { arquivo: "i18n/messages.ts", porque: "arrastado por i18n/config.ts" },
  { arquivo: "i18n/translate.ts", porque: "erro de rota traduzido na borda" },
];

describe("o que o middleware alcança não pode tocar em `node:`", () => {
  it.each(RAIZES_EDGE)(
    "$arquivo e tudo que ele importa ($porque)",
    async ({ arquivo }) => {
      const vistos = new Set<string>();
      const culpados: string[] = [];

      const visitar = async (rel: string): Promise<void> => {
        if (vistos.has(rel)) return;
        vistos.add(rel);

        let src: string;
        try {
          src = await readFile(join(SRC, rel), "utf8");
        } catch {
          return; // não é arquivo nosso (dependência externa)
        }

        for (const spec of especificadores(src)) {
          if (/^node:/.test(spec)) {
            culpados.push(`${rel} importa ${spec}`);
            continue;
          }
          if (!spec.startsWith(".")) continue;
          // Import relativo do núcleo: sem extensão, por causa do Turbopack.
          const destino = join(rel, "..", spec).split("\\").join("/");
          await visitar(`${destino}.ts`);
          await visitar(`${destino}/index.ts`);
        }
      };

      await visitar(arquivo);

      // A mensagem nomeia o caminho inteiro: quem quebrar isto precisa saber
      // que o sintoma NÃO vai ser um erro de tipo, vai ser o painel fora do ar.
      expect(
        culpados,
        `Estes módulos chegam ao Edge runtime pelo middleware e usam APIs do ` +
          `Node. O resultado não é um erro de tipo — é 404 em todas as rotas do ` +
          `painel. Mova o que lê disco/CPU para um módulo NODE-ONLY (ex.: ` +
          `container.ts) e importe-o só dos analisadores.\n  ` +
          culpados.join("\n  ")
      ).toEqual([]);
    }
  );
});

describe("o cgroup mora em `container.ts`, e só", () => {
  it("`config.ts` não importa o `container`", async () => {
    // A regressão exata: uma linha de import aqui e o painel some. Lido pelo
    // extrator que ignora comentários — o cabeçalho deste arquivo CITA o import
    // proibido para explicá-lo, e citar não é importar.
    const src = await readFile(join(SRC, "config.ts"), "utf8");
    expect(especificadores(src)).not.toContain("./container");
  });

  it("mas as funções continuam existindo, no lugar node-only", async () => {
    const { sastJobs, sastMaxMemoryMb } = await import("../src/container");
    expect(sastJobs()).toBeGreaterThanOrEqual(1);
    // `null` fora de contêiner, número dentro: as duas respostas são válidas.
    const mem = sastMaxMemoryMb();
    expect(mem === null || mem >= 128).toBe(true);
  });
});
