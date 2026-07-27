import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MESSAGES, PT_BR, type MessageKey } from "@/lib/i18n/messages";
import { LOCALES, LOCALE_LABEL, LOCALE_AI_NAME, normalizeLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/translate";

// O português é a referência e os outros idiomas caíam nele em silêncio — ou
// seja, uma chave nova só em pt-BR passava despercebida até alguém trocar o
// idioma e ver a tela meio traduzida. Este arquivo faz a falta virar erro, no
// mesmo espírito do teste de paridade do catálogo (AUDITORIA.md#PEND-18).
// Protege o trabalho do #PEND-23 e a entrada do espanhol no #FEAT-04.
//
// A paridade de CHAVES já é garantida pelo tipo (`Record<MessageKey, string>`
// em vez de `Partial`), o que a torna erro de COMPILAÇÃO. O que fica aqui é o
// que o tipo não pega: valor vazio, marcador de interpolação divergente e
// tradução esquecida (idêntica ao português).

const ptKeys = Object.keys(PT_BR).sort() as MessageKey[];
const OUTROS = LOCALES.filter((l) => l !== "pt-BR");

describe("idiomas · configuração (FEAT-04)", () => {
  it("são exatamente três: português, inglês e espanhol", () => {
    expect([...LOCALES]).toEqual(["pt-BR", "en", "es"]);
  });

  it("todo idioma tem rótulo próprio e nome para instruir a IA", () => {
    for (const l of LOCALES) {
      expect(LOCALE_LABEL[l]?.trim(), `sem rótulo: ${l}`).toBeTruthy();
      expect(LOCALE_AI_NAME[l]?.trim(), `sem nome de IA: ${l}`).toBeTruthy();
    }
  });

  it("variantes regionais caem no idioma base, não no padrão", () => {
    expect(normalizeLocale("es-AR")).toBe("es");
    expect(normalizeLocale("es-419")).toBe("es");
    expect(normalizeLocale("en-GB")).toBe("en");
    expect(normalizeLocale("pt-PT")).toBe("pt-BR");
    expect(normalizeLocale("klingon")).toBe("pt-BR");
    expect(normalizeLocale(undefined)).toBe("pt-BR");
  });
});

describe("dicionários · paridade de chaves (PEND-23)", () => {
  it("todo idioma cobre exatamente as chaves do português", () => {
    for (const locale of LOCALES) {
      const dict = MESSAGES[locale];
      const faltando = ptKeys.filter((k) => !(k in dict));
      const sobrando = Object.keys(dict).filter((k) => !(k in PT_BR));
      expect(faltando, `sem tradução em ${locale}: ${faltando.join(", ")}`).toEqual([]);
      expect(sobrando, `chave órfã em ${locale}: ${sobrando.join(", ")}`).toEqual([]);
    }
  });

  it("nenhum valor vazio em nenhum idioma", () => {
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
    for (const locale of OUTROS) {
      for (const k of ptKeys) {
        expect(
          marks(MESSAGES[locale][k]),
          `interpolação divergente em "${k}" (${locale})`
        ).toEqual(marks(PT_BR[k]));
      }
    }
  });

  it("nenhuma frase longa fica idêntica ao português — isso é cópia", () => {
    // Rótulo curto PODE coincidir de forma legítima: "Cancelar", "Abrir" e
    // "Crítica" são iguais em espanhol; "Status", "Menu" e "PR(s)" são iguais
    // em inglês. Listar cada um desses viraria uma lista de exceções maior que
    // o próprio teste, e ela ficaria desatualizada no primeiro rótulo novo.
    //
    // O que NÃO coincide por acaso é uma FRASE. Duas línguas diferentes não
    // produzem a mesma sentença de 30+ caracteres — quando isso acontece, o
    // valor foi copiado do português e nunca traduzido.
    const LIMIAR = 30;
    for (const locale of OUTROS) {
      const copiadas = ptKeys.filter(
        (k) => PT_BR[k].length >= LIMIAR && MESSAGES[locale][k] === PT_BR[k]
      );
      expect(
        copiadas,
        `frase idêntica ao português em ${locale}: ${copiadas.join(", ")}`
      ).toEqual([]);
    }
  });

  it("a maior parte do dicionário é de fato diferente do português", () => {
    // Rede de segurança contra o caso grosseiro: um idioma novo registrado
    // como cópia do português inteiro passaria em todos os testes acima
    // (chaves batem, nada vazio, interpolação idêntica) sem traduzir nada.
    for (const locale of OUTROS) {
      const iguais = ptKeys.filter((k) => MESSAGES[locale][k] === PT_BR[k]).length;
      const proporcao = iguais / ptKeys.length;
      expect(
        proporcao,
        `${locale}: ${iguais}/${ptKeys.length} chaves iguais ao português`
      ).toBeLessThan(0.2);
    }
  });

  it("interpola nos três idiomas sem deixar marcador na tela", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "card.line", { n: 42 })).toContain("42");
      expect(translate(locale, "card.line", { n: 42 })).not.toContain("{");
    }
  });
});

// Uma chave inventada aparece na tela como texto cru e denuncia a falta. Isso
// só ajuda se ninguém deixar literal solto no JSX. A lista abaixo é TODA a
// interface: a varredura do FEAT-04 fechou as telas que o PEND-23 tinha
// deixado pela metade.
describe("interface inteira · sem literal solto no JSX", () => {
  const ALVOS = [
    "app/page.tsx",
    "app/login/page.tsx",
    "app/analyses/page.tsx",
    "app/pull-requests/page.tsx",
    "app/account/page.tsx",
    "app/admin/page.tsx",
    "app/admin/users/page.tsx",
    "app/admin/monitoring/page.tsx",
    "app/admin/analyses/page.tsx",
    "app/report/[id]/page.tsx",
    "app/results/[id]/page.tsx",
    "components/AppShell.tsx",
    "components/BatchFixModal.tsx",
    "components/CodeDiff.tsx",
    "components/ExportMenu.tsx",
    "components/FixModal.tsx",
    "components/Modal.tsx",
    "components/NewUserModal.tsx",
    "components/Pagination.tsx",
    "components/PipelineStepper.tsx",
    "components/RepoInput.tsx",
    "components/SectionTabs.tsx",
    "components/SeverityBadge.tsx",
    "components/SkillFindingCard.tsx",
    "components/SkillInput.tsx",
    "components/ThreatInput.tsx",
    "components/TokenPicker.tsx",
    "components/TokenPrompt.tsx",
    "components/VulnerabilityCard.tsx",
    "components/filters.tsx",
    "components/listing.tsx",
  ];

  const ler = (rel: string) =>
    readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

  it("nenhuma tela tem texto fixo entre tags", () => {
    for (const rel of ALVOS) {
      // Texto entre tags com pelo menos duas palavras seguidas em letras
      // latinas é o padrão que sobrou nas telas antigas.
      const suspeitos = [...ler(rel).matchAll(/>\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^<>{}\n]{6,})\s*</g)]
        .map((m) => m[1].trim())
        .filter((s) => /[a-zà-ú]\s+[a-zà-ú]/i.test(s));
      expect(suspeitos, `${rel} ainda tem literal no JSX`).toEqual([]);
    }
  });

  it("nenhum placeholder, title ou aria-label fixo em português", () => {
    // Estes atributos NÃO aparecem entre tags, então escapavam da varredura
    // acima — e são exatamente onde ficaram os últimos textos em português.
    const ATRIBUTOS = /(placeholder|aria-label|title|ariaLabel|label)=\{?"([^"]{4,})"/g;
    // Palavras que denunciam português/uma frase, e não um valor técnico
    // ("url", "ghp_…", "Personal Access Token" são legítimos).
    const CHEIRO_DE_FRASE = /[a-zà-ú]\s+[a-zà-ú]|[áàâãéêíóôõúç]/i;
    const EXCECOES = new Set(["Personal Access Token", "Starbridge"]);

    for (const rel of ALVOS) {
      const suspeitos = [...ler(rel).matchAll(ATRIBUTOS)]
        .map((m) => m[2].trim())
        .filter((v) => CHEIRO_DE_FRASE.test(v) && !EXCECOES.has(v));
      expect(suspeitos, `${rel} tem atributo com texto fixo`).toEqual([]);
    }
  });
});

// Texto que o SERVIDOR escreve e que fica GRAVADO no JSONB `phases`: ele não
// passa por `t()` na hora de exibir — é lido do banco como está. Se sair em
// português para um usuário em espanhol, não há como corrigir depois.
describe("mensagens do servidor · escritas já traduzidas", () => {
  const DO_SERVIDOR: MessageKey[] = [
    "job.orphan",
    "job.stale",
    "job.phaseFailed",
    "job.unexpected",
    "scan.noRepo",
    "scan.sastOff",
    "scan.scaOff",
    "skillCheck.scope",
    "skillCheck.noExfiltration",
    "skillCheck.noPolicyBypass",
    "skillCheck.noCommandExec",
    "skillFinding.promptInjection.title",
    "skillFinding.promptInjection.fix",
    "skillFinding.dataExfiltration.title",
    "skillFinding.dataExfiltration.fix",
    "skillFinding.backdoor.title",
    "skillFinding.backdoor.fix",
    "skillFinding.policyBypass.title",
    "skillFinding.policyBypass.fix",
    "depExplain.title",
    "depExplain.whatItIs",
    "depExplain.whyItMatters",
    "depExplain.howToFix",
    "depExplain.noFixedVersion",
  ];

  it("existem e diferem entre os idiomas", () => {
    for (const k of DO_SERVIDOR) {
      for (const locale of OUTROS) {
        expect(MESSAGES[locale][k]?.trim(), `${locale}.${k} vazio`).toBeTruthy();
        expect(MESSAGES[locale][k], `${locale}.${k} não traduzido`).not.toBe(
          PT_BR[k]
        );
      }
    }
  });
});
