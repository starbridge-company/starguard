import { describe, it, expect } from "vitest";
import { diffLines, toChunks, diffStats } from "@/lib/diff";

// AUDITORIA.md#UX-02 — a tela mostrava o arquivo corrigido inteiro; revisar
// uma correção de 2 linhas num arquivo de 400 era ler 400 linhas.
describe("diff · UX-02", () => {
  const original = Array.from({ length: 200 }, (_, i) => `linha ${i + 1}`);

  it("uma correção cirúrgica cabe na tela", () => {
    const fixed = [...original];
    fixed[99] = 'execFile("ls", [input]); // corrigido';
    fixed.splice(100, 0, "// StarGuard: sem shell");

    const d = diffLines(original.join("\n"), fixed.join("\n"));
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });

    const visiveis = toChunks(d, 3).reduce((n, c) => n + c.lines.length, 0);
    expect(visiveis).toBeLessThan(15); // ~9 na prática, contra 200 do arquivo
  });

  it("arquivos idênticos não produzem alteração", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc");
    expect(diffStats(d)).toEqual({ added: 0, removed: 0 });
  });

  it("marca inserção pura", () => {
    const d = diffLines("a\nc", "a\nb\nc");
    expect(diffStats(d)).toEqual({ added: 1, removed: 0 });
    expect(d.find((l) => l.type === "add")?.text).toBe("b");
  });

  it("marca remoção pura", () => {
    const d = diffLines("a\nb\nc", "a\nc");
    expect(diffStats(d)).toEqual({ added: 0, removed: 1 });
    expect(d.find((l) => l.type === "del")?.text).toBe("b");
  });

  it("numera as linhas dos dois lados", () => {
    const d = diffLines("a\nb", "a\nB");
    const add = d.find((l) => l.type === "add");
    const del = d.find((l) => l.type === "del");
    expect(del?.aNum).toBe(2);
    expect(add?.bNum).toBe(2);
    expect(add?.aNum).toBeUndefined(); // linha nova não existe no original
  });

  it("aguenta arquivo reescrito por inteiro sem travar", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
    const t0 = Date.now();
    const d = diffLines(a, b);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(diffStats(d).added).toBe(3000);
  });

  it("normaliza CRLF (arquivo vindo do Windows)", () => {
    expect(diffStats(diffLines("a\r\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });
});
