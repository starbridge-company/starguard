import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(join(root, "app", "globals.css"), "utf8");
const shell = readFileSync(join(root, "components", "AppShell.tsx"), "utf8");
const tabs = readFileSync(join(root, "components", "SectionTabs.tsx"), "utf8");

describe("navegação responsiva", () => {
  it("a regra móvel do botão de menu vence a regra base", () => {
    const ultimaRegra = css.lastIndexOf(".mobile-menu-toggle {");
    expect(ultimaRegra).toBeGreaterThan(-1);
    expect(css.slice(ultimaRegra, ultimaRegra + 100)).toContain("display: inline-flex");
  });

  it("o menu declara estado, relação e fechamento por Escape", () => {
    expect(shell).toContain('aria-controls="app-sidebar"');
    expect(shell).toContain('aria-expanded={open}');
    expect(shell).toContain('e.key === "Escape"');
  });

  it("as abas seguem o padrão de teclado ARIA", () => {
    expect(tabs).toContain('e.key === "ArrowRight"');
    expect(tabs).toContain('e.key === "ArrowLeft"');
    expect(tabs).toContain('e.key === "Home"');
    expect(tabs).toContain('e.key === "End"');
    expect(tabs).toContain("tabIndex={t.id === active ? 0 : -1}");
  });
});
