import { describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copiarManifestosPara } from "../src/bundle";

describe("workspace mínimo do SCA", () => {
  it("copia lockfiles preservando caminho e deixa código/assets de fora", async () => {
    const base = await mkdtemp(join(tmpdir(), "sg-sca-copy-"));
    const origem = join(base, "repo");
    const destino = join(base, "manifestos");
    await mkdir(join(origem, "apps", "web", "src"), { recursive: true });
    await writeFile(join(origem, "apps", "web", "package.json"), "{}", "utf8");
    await writeFile(join(origem, "apps", "web", "package-lock.json"), "{}", "utf8");
    await writeFile(join(origem, "apps", "web", "src", "app.ts"), "export {}", "utf8");
    try {
      const copiados = await copiarManifestosPara(origem, destino);
      expect(copiados.sort()).toEqual([
        "apps/web/package-lock.json",
        "apps/web/package.json",
      ]);
      await expect(access(join(destino, "apps", "web", "package.json"))).resolves.toBeUndefined();
      await expect(access(join(destino, "apps", "web", "src", "app.ts"))).rejects.toThrow();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
