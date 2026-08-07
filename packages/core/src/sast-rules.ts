// ============================================================
// Onde estão as REGRAS do SAST. NODE-ONLY.
//
// Por que isto virou um módulo, e não uma linha em `config.ts`:
//
// **`--config auto` não funciona com o opengrep.** Medido na versão 1.25.0:
// `opengrep --config auto --json --quiet ... .` sai com **exit 2, stdout vazio
// e stderr vazio**, depois de ~27 s tentando a rede. Não é lentidão — é
// inutilidade, e silenciosa. O `auto` é herança do Semgrep, cujo registro
// remoto o opengrep não implementa.
//
// Esse padrão era o que sobrava para quem não configurasse `SAST_RULES`, e o
// sintoma que ele produzia não tinha nada a ver com a causa:
//
//   - no painel web funcionava, porque o Next carrega `.env.local`, que tem a
//     variável;
//   - no Docker funcionava, porque a imagem define `SAST_RULES=/opt/…`;
//   - **na extensão do VS Code não funcionava**, porque o extension host não lê
//     `.env.local` de projeto nenhum — e ninguém tinha preenchido
//     `starguard.sastRules`.
//
// Três produtos, o mesmo motor, e o SAST quebrado só num deles. A mensagem que
// chegava à tela era `Falha no SAST: Unexpected end of JSON input`: o
// `JSON.parse` de uma saída vazia. Um erro de parser no lugar de "faltam
// regras".
//
// O conserto tem duas metades, e as duas estão aqui:
//
//   1. **procurar** as regras nos lugares onde elas de fato ficam, em vez de
//      exigir configuração de quem já as tem no disco;
//   2. quando não houver nenhuma, **dizer isso antes de rodar** — o analisador
//      sai do plano com motivo e ação, que é a regra do UX-15, em vez de gastar
//      27 s para morrer sem explicação.
// ============================================================
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { BIN, ENGINES, sastConfig } from "./config";

export type OrigemDasRegras =
  /** `SAST_RULES` (ou `starguard.sastRules`, que a extensão traduz para ela). */
  | "env"
  /** Achado no disco, num dos lugares convencionais. É DECLARADO, nunca mudo. */
  | "detectado"
  /** Nenhuma regra local. Com opengrep isto NÃO funciona — ver o cabeçalho. */
  | "auto";

export interface RegrasDoSast {
  /** O valor que vai para `--config`. */
  config: string;
  origem: OrigemDasRegras;
}

/**
 * Um diretório só vale se **tiver regra dentro**.
 *
 * Um `opengrep-rules/` vazio — clone interrompido, submódulo não inicializado —
 * é pior que nenhum: o scan roda, não encontra nada e o relatório parece um
 * repositório limpo. É o UX-15 na sua forma mais cara.
 *
 * **A busca desce até `FUNDO_MAX` níveis**, e a primeira versão disto errou por
 * parar no segundo. O `opengrep-rules` guarda as regras por linguagem e por
 * categoria — a primeira é `ai/csharp/detect-openai.yaml`, três níveis abaixo
 * da raiz —, então uma checagem rasa concluía "não há regras aqui" com 2.021
 * arquivos no disco. Medido nesta máquina, e foi o que fez a detecção nascer
 * quebrada.
 *
 * Para na PRIMEIRA regra encontrada, e tem teto de diretórios visitados: a
 * pergunta é "há um ruleset aqui?", não "quantas regras há?". Quem valida
 * conteúdo de regra é o opengrep.
 */
const FUNDO_MAX = 4;
const DIRS_MAX = 400;

function temRegras(raiz: string): boolean {
  let visitados = 0;
  const procurar = (dir: string, fundo: number): boolean => {
    if (fundo > FUNDO_MAX || visitados++ > DIRS_MAX) return false;
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    // Arquivos primeiro: quando há regra neste nível, não se desce nenhum.
    for (const e of entradas) {
      if (e.isFile() && /\.ya?ml$/i.test(e.name)) return true;
    }
    for (const e of entradas) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (procurar(join(dir, e.name), fundo + 1)) return true;
    }
    return false;
  };
  return procurar(raiz, 0);
}

/**
 * Os lugares onde um ruleset de opengrep costuma estar, na ordem em que fazem
 * sentido procurar.
 *
 * Ao lado do binário vem primeiro porque é onde quem instalou à mão o coloca —
 * `~/bin/opengrep.exe` e `~/bin/opengrep-rules/` lado a lado é o arranjo mais
 * comum no Windows, e era exatamente o caso desta máquina: as 2.021 regras
 * estavam no disco, a um diretório de distância do binário, e o scan ia buscar
 * na internet.
 *
 * `/opt/opengrep-rules` é o caminho que o nosso Dockerfile usa — a imagem já
 * define `SAST_RULES`, mas listá-lo aqui faz a detecção continuar valendo se
 * alguém rodar o binário fora do nosso entrypoint.
 */
function candidatos(): string[] {
  const lista: string[] = [];
  const bin = ENGINES.sast === "semgrep" ? BIN.semgrep : BIN.opengrep;

  // Só dá para olhar "ao lado" quando o caminho do binário é conhecido. Quando
  // ele é só `"opengrep"` (resolvido pelo PATH), não há diretório a inspecionar
  // sem sair procurando no PATH inteiro — que é caro e adivinhação.
  if (isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) {
    lista.push(join(dirname(bin), "opengrep-rules"));
    lista.push(join(dirname(bin), "rules"));
  }

  const casa = homedir();
  if (casa) {
    lista.push(join(casa, "bin", "opengrep-rules"));
    lista.push(join(casa, ".opengrep", "rules"));
    lista.push(join(casa, ".opengrep", "opengrep-rules"));
  }
  lista.push("/opt/opengrep-rules");
  return lista;
}

// O resultado é memorizado: `sastConfig()` é chamado a cada montagem de plano —
// no editor, a cada clique — e cada chamada faria meia dúzia de `readdir`.
let cache: { chave: string; valor: RegrasDoSast } | undefined;

/** Esquece o que foi detectado. O `doctor` precisa ver o estado de AGORA. */
export function limparCacheDeRegras(): void {
  cache = undefined;
}

/**
 * Onde estão as regras, e como se chegou nelas.
 *
 * A `origem` não é detalhe interno: ela é o que permite dizer na tela "usando
 * as regras de X, encontradas no disco" em vez de mudar o comportamento por
 * baixo. Detecção silenciosa é a mesma falta que o transporte remoto evita —
 * o produto não decide sozinho, ele decide e conta.
 */
export function regrasDoSast(): RegrasDoSast {
  // `sastConfig()` continua sendo o ÚNICO leitor de `SAST_RULES` — ele devolve
  // `"auto"` quando a variável não está posta, e é exatamente esse caso que a
  // detecção abaixo existe para cobrir. Duas leituras da mesma variável seriam
  // duas verdades a manter em sincronia.
  const bruto = sastConfig();
  const env = bruto === "auto" ? undefined : bruto;
  const chave = `${env ?? ""}|${BIN.opengrep}|${BIN.semgrep}|${ENGINES.sast}`;
  if (cache?.chave === chave) return cache.valor;

  let valor: RegrasDoSast;
  if (env) {
    // Configuração explícita é respeitada mesmo que o diretório esteja vazio ou
    // não exista: quem apontou um caminho precisa ver o erro do caminho que
    // apontou, não um fallback silencioso para outro lugar.
    valor = { config: env, origem: "env" };
  } else {
    const achado = candidatos().find((d) => existsSync(d) && temRegras(d));
    valor = achado
      ? { config: achado, origem: "detectado" }
      : { config: "auto", origem: "auto" };
  }

  cache = { chave, valor };
  return valor;
}

/**
 * Dá para escanear código com esta configuração?
 *
 * `auto` só serve para o Semgrep de verdade. Com opengrep é uma execução de
 * 27 s que termina em nada — e responder "não dá, e eis o porquê" antes de
 * gastar esse tempo é o que separa uma ferramenta de uma espera.
 */
export function regrasUsaveis(): boolean {
  if (ENGINES.sast === "semgrep") return true;
  return regrasDoSast().origem !== "auto";
}

// ============================================================
// Só as regras das linguagens QUE ESTÃO no repositório
// ============================================================
//
// Medido na imagem de produção, com meia CPU, sobre os MESMOS 27 arquivos
// TypeScript:
//
//   ruleset inteiro (1094 regras, 11 linguagens) → 348 s
//   só javascript + typescript (181 regras)      →  65 s
//
// **5,4× de diferença.** As 913 regras descartadas são de python, java, go,
// php, ruby, csharp, c e html: num repositório TypeScript elas não têm como
// casar com nada. O tempo gasto com elas não compra achado nenhum — compra
// espera, e num contêiner de meia CPU essa espera é a diferença entre uma
// análise que termina e uma que estoura o teto.
//
// ---- A regra que impede isto de virar um relatório menor ----
//
// Estreitar ruleset troca cobertura por velocidade, e errar a detecção faz o
// relatório encolher EM SILÊNCIO — o pior desfecho possível numa ferramenta de
// segurança (UX-15). Por isso o desenho é conservador em três pontos:
//
//   1. **Na dúvida, não estreita.** Layout que não parece o `opengrep-rules`
//      (sem diretórios por linguagem) devolve a raiz inteira, como antes.
//   2. **`generic` entra SEMPRE.** É onde moram as regras que não dependem de
//      linguagem — segredo em código, chave privada commitada. São 250 regras
//      que valem para qualquer repositório.
//   3. **É DECLARADO.** Quem roda vê quais conjuntos entraram, na tela e no
//      terminal. Ninguém precisa deduzir por que o número de achados mudou.

/**
 * Extensão de arquivo → diretório de regra do `opengrep-rules`.
 *
 * `.ts`/`.tsx` levam junto o `javascript`: as regras de JS valem para TS (é o
 * mesmo runtime e a mesma API), e o `typescript` do ruleset tem só 18 regras
 * contra 163 do `javascript`. Estreitar para `typescript` puro jogaria fora a
 * maior parte da cobertura real de um projeto Node — que é este aqui.
 */
const DIR_POR_EXTENSAO: Record<string, string[]> = {
  ".js": ["javascript"],
  ".jsx": ["javascript"],
  ".mjs": ["javascript"],
  ".cjs": ["javascript"],
  ".ts": ["typescript", "javascript"],
  ".tsx": ["typescript", "javascript"],
  ".mts": ["typescript", "javascript"],
  ".cts": ["typescript", "javascript"],
  ".py": ["python"],
  ".pyi": ["python"],
  ".java": ["java"],
  ".go": ["go"],
  ".php": ["php"],
  ".rb": ["ruby"],
  ".erb": ["ruby"],
  ".cs": ["csharp"],
  ".c": ["c"],
  ".h": ["c"],
  ".html": ["html"],
  ".htm": ["html"],
  ".vue": ["javascript"],
  ".svelte": ["javascript"],
};

/** Vale para qualquer repositório: segredo, chave privada, configuração. */
const SEMPRE = "generic";

/** Pastas que não são código de ninguém — varrê-las é custo sem achado. */
const IGNORAR = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "vendor",
  "coverage",
  "__pycache__",
  ".venv",
  "target",
]);

/** Teto da varredura: a pergunta é "que linguagens há aqui?", não "quantos arquivos". */
const ARQUIVOS_MAX = 4000;

/**
 * Que linguagens existem neste diretório, pelo sufixo dos arquivos.
 *
 * Não abre arquivo nenhum: extensão basta e custa um `readdir`. Um repositório
 * poliglota devolve várias e recebe todas as regras correspondentes — o
 * estreitamento nunca decide entre linguagens, só descarta as ausentes.
 */
export function linguagensEm(raiz: string): Set<string> {
  const achadas = new Set<string>();
  let vistos = 0;

  const andar = (dir: string, fundo: number) => {
    if (fundo > 8 || vistos > ARQUIVOS_MAX) return;
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (vistos > ARQUIVOS_MAX) return;
      if (e.name.startsWith(".") && e.name !== ".") continue;
      if (e.isDirectory()) {
        if (!IGNORAR.has(e.name)) andar(join(dir, e.name), fundo + 1);
        continue;
      }
      if (!e.isFile()) continue;
      vistos++;
      const ponto = e.name.lastIndexOf(".");
      if (ponto <= 0) continue;
      const dirs = DIR_POR_EXTENSAO[e.name.slice(ponto).toLowerCase()];
      if (dirs) for (const d of dirs) achadas.add(d);
    }
  };

  andar(raiz, 0);
  return achadas;
}

export interface RegrasEscolhidas {
  /** O que vai para `--config`. Um por diretório escolhido. */
  configs: string[];
  /** Os nomes escolhidos, para DIZER na tela. Vazio = ruleset inteiro. */
  linguagens: string[];
  /** Quantos diretórios de linguagem o ruleset tem ao todo. */
  disponiveis: number;
}

/**
 * As regras que interessam para o código de `raiz`.
 *
 * Devolve `configs` com UM item (a raiz do ruleset) quando não dá para estreitar
 * com segurança — que é o comportamento de sempre. `linguagens` vazio é o sinal
 * de "não estreitei", e é o que a mensagem na tela usa para não mentir.
 */
export function regrasParaOCodigo(ruleset: string, raiz: string): RegrasEscolhidas {
  const inteiro: RegrasEscolhidas = { configs: [ruleset], linguagens: [], disponiveis: 0 };

  // `SAST_NARROW_RULES=0` desliga tudo isto. Existe porque a troca é real: quem
  // preferir pagar o tempo para não depender da detecção tem como escolher.
  if (process.env.SAST_NARROW_RULES === "0") return inteiro;

  let entradas;
  try {
    entradas = readdirSync(ruleset, { withFileTypes: true });
  } catch {
    return inteiro;
  }

  // Só estreita um layout que RECONHECE. Um diretório de regras próprio, sem
  // pastas por linguagem, é devolvido inteiro — o contrário jogaria fora o
  // ruleset de quem o escreveu à mão.
  const porLinguagem = new Set(
    entradas
      .filter((e) => e.isDirectory() && (e.name in NOMES_DE_LINGUAGEM || e.name === SEMPRE))
      .map((e) => e.name)
  );
  if (porLinguagem.size < 2) return inteiro;

  const presentes = linguagensEm(raiz);
  // Nenhuma linguagem conhecida no repositório: pode ser um projeto de algo que
  // não mapeamos. Rodar o ruleset inteiro é mais lento e não perde nada.
  if (presentes.size === 0) return inteiro;

  const escolhidos = [...presentes].filter((l) => porLinguagem.has(l)).sort();
  if (escolhidos.length === 0) return inteiro;

  // O `generic` entra sempre que existir — ver o item 2 do cabeçalho.
  const comGenerico = porLinguagem.has(SEMPRE) ? [...escolhidos, SEMPRE] : escolhidos;

  return {
    configs: comGenerico.map((l) => join(ruleset, l)),
    linguagens: comGenerico,
    disponiveis: porLinguagem.size,
  };
}

/** Os nomes de pasta que o `opengrep-rules` usa. Fonte do reconhecimento acima. */
const NOMES_DE_LINGUAGEM: Record<string, true> = Object.fromEntries(
  [...new Set(Object.values(DIR_POR_EXTENSAO).flat())].map((n) => [n, true])
) as Record<string, true>;
