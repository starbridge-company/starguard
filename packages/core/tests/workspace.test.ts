// ============================================================
// Workspace — AUDITORIA.md#ARQ-13.
//
// O caminho NEGATIVO é o que importa aqui, e é obrigatório pela regra do
// CLAUDE.md ("regra de segurança tem teste do que deve ser recusado"). O
// `rel` que chega em `readFile` vem de relatório de scanner, de JSON de modelo
// ou de achado gravado meses atrás — nunca de nós. Um `../../.ssh/id_rsa` ali
// dentro transformaria "abrir o arquivo do achado" em leitura arbitrária do
// disco, e no VS Code esse disco é a máquina de trabalho de uma pessoa.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openWorkspace } from "../src/workspace";

let raiz = "";
let fora = "";

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "sg-ws-test-"));
  raiz = join(base, "projeto");
  fora = join(base, "segredos");
  await mkdir(raiz, { recursive: true });
  await mkdir(fora, { recursive: true });
  await mkdir(join(raiz, "src"), { recursive: true });
  await writeFile(join(raiz, "src", "app.ts"), "export const x = 1;\n");
  await writeFile(join(fora, "id_rsa"), "CHAVE PRIVADA\n");
});

afterAll(async () => {
  await rm(resolve(raiz, ".."), { recursive: true, force: true });
});

describe("workspace local", () => {
  it("abre um diretório existente e lê por caminho relativo", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    expect(ws!.kind).toBe("local");
    expect(await ws!.readFile("src/app.ts")).toContain("export const x");
  });

  it("recusa diretório inexistente com erro acionável", async () => {
    await expect(
      openWorkspace({ type: "local", path: join(raiz, "nao-existe") })
    ).rejects.toThrow(/não encontrado/i);
  });

  it("`none` não abre workspace nenhum", async () => {
    expect(await openWorkspace({ type: "none" })).toBeUndefined();
  });

  it("descartar um workspace local NÃO apaga o diretório de quem chamou", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    await ws!.dispose();
    // O diretório é da pessoa, não nosso. Apagá-lo seria catastrófico.
    expect(await readFile(join(raiz, "src", "app.ts"), "utf8")).toContain("export");
  });

  it("dispose é idempotente", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    await ws!.dispose();
    await expect(ws!.dispose()).resolves.toBeUndefined();
  });
});

describe("confinamento à raiz — o caminho que deve ser RECUSADO", () => {
  const escapes = [
    ["subir um nível", "../segredos/id_rsa"],
    ["subir vários níveis", "../../../../../../etc/passwd"],
    ["subir no meio do caminho", "src/../../segredos/id_rsa"],
    ["separador do Windows", "..\\segredos\\id_rsa"],
  ] as const;

  for (const [nome, caminho] of escapes) {
    it(`recusa leitura ao ${nome}: ${caminho}`, async () => {
      const ws = await openWorkspace({ type: "local", path: raiz });
      expect(await ws!.readFile(caminho)).toBeNull();
    });
  }

  it("recusa caminho ABSOLUTO mesmo apontando para dentro da raiz", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    // Aceitá-lo tornaria a regra dependente do que veio de fora: bastaria o
    // scanner emitir caminho absoluto para o confinamento deixar de valer.
    expect(await ws!.readFile(join(raiz, "src", "app.ts"))).toBeNull();
  });

  it("recusa string vazia", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    expect(await ws!.readFile("")).toBeNull();
  });

  it("GRAVAÇÃO fora da raiz lança em vez de escrever", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    await expect(
      ws!.writeFile("../segredos/id_rsa", "sobrescrito")
    ).rejects.toThrow(/fora do workspace/i);
    // E o arquivo de fora continua intacto.
    expect(await readFile(join(fora, "id_rsa"), "utf8")).toBe("CHAVE PRIVADA\n");
  });

  it("arquivo inexistente DENTRO da raiz devolve null, não lança", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    // Achado apontando para arquivo já removido é caso normal, não erro.
    expect(await ws!.readFile("src/removido.ts")).toBeNull();
  });

  it("grava dentro da raiz, criando o diretório que faltar", async () => {
    const ws = await openWorkspace({ type: "local", path: raiz });
    await ws!.writeFile("novo/dir/arquivo.ts", "conteúdo");
    expect(await ws!.readFile("novo/dir/arquivo.ts")).toBe("conteúdo");
  });
});
