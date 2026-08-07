import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

describe("compatibilidade com Next 16", () => {
  it("usa a convenção proxy, não o middleware depreciado", () => {
    expect(existsSync(join(ROOT, "middleware.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "proxy.ts"))).toBe(true);
    expect(readFileSync(join(ROOT, "proxy.ts"), "utf8")).toMatch(
      /export async function proxy\(/
    );
  });

  it("workspaces locais não fazem o file tracer empacotar o repositório inteiro", () => {
    const fonte = readFileSync(
      join(ROOT, "packages", "core", "src", "workspace.ts"),
      "utf8"
    );
    // O build do Next 16 avisava que `next.config.mjs` entrou no NFT da rota de
    // correção: o `fs.readFile` dinâmico tinha sido interpretado como ativo do
    // servidor. Estes marcadores são o contrato com o tracer.
    expect(fonte.match(/\/\*turbopackIgnore: true\*\//g)?.length).toBeGreaterThanOrEqual(6);
  });
});
