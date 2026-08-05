// ============================================================
// Instalação do hook de pre-commit — AUDITORIA.md#SEC-12.
//
// Dois comportamentos aqui são de segurança operacional, não de conveniência:
//
//  1. **Não sobrescrever hook de terceiro.** Muito projeto já tem husky ou um
//     script próprio no `pre-commit`. Apagá-lo em silêncio quebraria o fluxo do
//     time — e o sintoma ("meus testes pararam de rodar no commit") não
//     apontaria para o StarGuard.
//  2. **Respeitar `core.hooksPath`.** Quem usa husky tem os hooks em `.husky/`.
//     Escrever no lugar errado instala um hook que NUNCA roda: o pior
//     desfecho, porque parece que funcionou.
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conteudoDoHook, instalarHook, removerHook } from "../src/hook";

const pExecFile = promisify(execFile);
let repo = "";

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "sg-hook-"));
  await pExecFile("git", ["init", "-q"], { cwd: repo });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("instalação", () => {
  it("instala em .git/hooks e o arquivo fica executável", async () => {
    const r = await instalarHook(repo, await conteudoDoHook());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.acao).toBe("instalado");

    const conteudo = await readFile(r.caminho, "utf8");
    expect(conteudo).toContain("StarGuard");

    if (process.platform !== "win32") {
      // Hook sem permissão de execução é silenciosamente ignorado pelo git —
      // o modo de falha mais confuso desta área.
      const s = await stat(r.caminho);
      expect(s.mode & 0o111).toBeGreaterThan(0);
    }
  });

  it("reinstalar ATUALIZA o nosso, sem reclamar", async () => {
    await instalarHook(repo, await conteudoDoHook());
    const r = await instalarHook(repo, await conteudoDoHook());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.acao).toBe("atualizado");
  });

  it("RECUSA sobrescrever hook de outra ferramenta", async () => {
    const dir = join(repo, ".git", "hooks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pre-commit"), "#!/bin/sh\nnpx lint-staged\n");

    const r = await instalarHook(repo, await conteudoDoHook());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("hook_de_terceiro");

    // E o hook alheio continua intacto — é a parte que importa.
    expect(await readFile(join(dir, "pre-commit"), "utf8")).toContain("lint-staged");
  });

  it("respeita `core.hooksPath` (husky, lefthook)", async () => {
    // Ignorá-lo instalaria em `.git/hooks/`, onde o git nem olharia.
    await pExecFile("git", ["config", "core.hooksPath", ".husky"], { cwd: repo });
    const r = await instalarHook(repo, await conteudoDoHook());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.caminho.replace(/\\/g, "/")).toContain("/.husky/pre-commit");
  });

  it("fora de um repositório git, recusa com motivo", async () => {
    const naoRepo = await mkdtemp(join(tmpdir(), "sg-naorepo-"));
    try {
      const r = await instalarHook(naoRepo, await conteudoDoHook());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe("nao_e_repo");
    } finally {
      await rm(naoRepo, { recursive: true, force: true });
    }
  });
});

describe("remoção", () => {
  it("remove o nosso", async () => {
    await instalarHook(repo, await conteudoDoHook());
    const r = await removerHook(repo);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.acao).toBe("removido");
  });

  it("NÃO remove hook de terceiro", async () => {
    const dir = join(repo, ".git", "hooks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pre-commit"), "#!/bin/sh\necho outro\n");

    const r = await removerHook(repo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("hook_de_terceiro");
    expect(await readFile(join(dir, "pre-commit"), "utf8")).toContain("outro");
  });

  it("remover o que não existe é recusa, não erro", async () => {
    const r = await removerHook(repo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_instalado");
  });
});

describe("o conteúdo do hook", () => {
  it("roda SÓ o que é rápido: sast, sca, e --no-ai", async () => {
    // A restrição é o desenho: um hook que segura o commit chamando modelo é
    // desinstalado no primeiro dia. O que exige IA acontece no servidor.
    const c = await conteudoDoHook();
    expect(c).toContain("--only sast,sca");
    expect(c).toContain("--no-ai");
  });

  it("por padrão AVISA e deixa passar", async () => {
    // Bloquear commit é decisão de time, não nossa.
    const c = await conteudoDoHook();
    expect(c).toContain("starguard.hookBlocks");
    expect(c).toMatch(/echo "false"/);
  });

  it("sai limpo se o StarGuard não estiver instalado", async () => {
    // Ferramenta ausente não pode impedir ninguém de commitar.
    const c = await conteudoDoHook();
    expect(c).toContain("command -v starguard");
  });
});
