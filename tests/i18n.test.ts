import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MESSAGES, PT_BR } from "@/lib/i18n/messages";

// O português é a referência e o inglês caía nele em silêncio — ou seja, uma
// chave nova só em pt-BR passava despercebida até alguém trocar o idioma e ver
// a tela meio traduzida. Este arquivo faz a falta virar erro de build, no
// mesmo espírito do teste de paridade do catálogo (AUDITORIA.md#PEND-18).
// Protege o trabalho do #PEND-23.

const ptKeys = Object.keys(PT_BR).sort();

describe("dicionários · paridade de chaves (PEND-23)", () => {
  it("toda chave do português existe em inglês", () => {
    const en = MESSAGES.en ?? {};
    const faltando = ptKeys.filter((k) => !(k in en));
    expect(faltando, `sem tradução em inglês: ${faltando.join(", ")}`).toEqual([]);
  });

  it("o inglês não inventa chave que não existe no português", () => {
    const sobrando = Object.keys(MESSAGES.en ?? {}).filter((k) => !(k in PT_BR));
    expect(sobrando, `chave órfã em inglês: ${sobrando.join(", ")}`).toEqual([]);
  });

  it("nenhum valor vazio nos dois idiomas", () => {
    for (const [locale, dict] of Object.entries(MESSAGES)) {
      for (const [k, v] of Object.entries(dict)) {
        expect(String(v).trim(), `${locale}.${k} está vazio`).not.toBe("");
      }
    }
  });

  it("os marcadores de interpolação batem entre os idiomas", () => {
    // `{n}` no português e `{count}` no inglês devolveria o marcador cru na
    // tela — o tipo de erro que só aparece com o dado real na mão.
    const marks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = MESSAGES.en ?? {};
    for (const k of ptKeys) {
      const alvo = en[k as keyof typeof en];
      if (!alvo) continue;
      expect(marks(alvo), `interpolação divergente em "${k}"`).toEqual(
        marks(PT_BR[k as keyof typeof PT_BR])
      );
    }
  });
});

// O comportamento do `translate` (fallback e interpolação) já é coberto por
// tests/catalog.test.ts — aqui o objeto é o CONTEÚDO dos dicionários.

// Uma chave inventada aparece na tela como texto cru e denuncia a falta. Isso
// só ajuda se ninguém deixar literal solto no JSX das telas que o PEND-23
// cobre.
describe("telas do PEND-23 · sem literal solto no JSX", () => {
  const ALVOS = [
    "app/pull-requests/page.tsx",
    "app/account/page.tsx",
    "app/admin/page.tsx",
    "app/admin/users/page.tsx",
    "app/admin/monitoring/page.tsx",
    "app/admin/analyses/page.tsx",
    "app/report/[id]/page.tsx",
    "components/NewUserModal.tsx",
    "components/PipelineStepper.tsx",
  ];

  it("as telas migradas usam t() e não texto fixo entre tags", () => {
    for (const rel of ALVOS) {
      const src = readFileSync(
        fileURLToPath(new URL(`../${rel}`, import.meta.url)),
        "utf8"
      );
      // Texto entre tags com pelo menos duas letras acentuadas ou duas
      // palavras seguidas em português é o padrão que sobrou nas telas antigas.
      const suspeitos = [...src.matchAll(/>\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^<>{}\n]{6,})\s*</g)]
        .map((m) => m[1].trim())
        .filter((s) => /[a-zà-ú]\s+[a-zà-ú]/i.test(s));
      expect(suspeitos, `${rel} ainda tem literal no JSX`).toEqual([]);
    }
  });
});
