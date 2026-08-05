// ============================================================
// Argumentos e configuração do `starguard`.
//
// `node:util.parseArgs` faz o trabalho de um `commander` para o tamanho desta
// superfície. O que ele NÃO faz — e é o que mora aqui — é dar significado:
// `--only sast,sca` virar uma lista de ids válidos, `--fail-on high` virar um
// limiar de severidade, e o `.starguard.json` do repositório entrar como
// padrão sem atropelar a flag que a pessoa acabou de digitar.
//
// A precedência é a de sempre e vale escrever: FLAG > variável de ambiente >
// `.starguard.json` > padrão. Quem digitou algo agora está mais certo que um
// arquivo escrito mês passado.
// ============================================================
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ANALYZER_IDS, isAnalyzerId, type AnalyzerId } from "@starguard/core/types";
import { normalizeLocale, type Locale } from "@starguard/core/i18n/config";

export type Comando =
  | "scan"
  | "skills"
  | "fix"
  | "doctor"
  | "list"
  | "login"
  | "logout"
  | "whoami"
  | "hook"
  | "help"
  | "version";

export type Severidade = "critical" | "high" | "medium" | "low" | "info";

const ORDEM_SEVERIDADE: Severidade[] = ["critical", "high", "medium", "low", "info"];

export interface Opcoes {
  comando: Comando;
  /** Caminho local ou URL do repositório. Padrão: o diretório atual. */
  alvo: string;
  /** Argumentos livres depois do comando (arquivos de skill, ids de achado). */
  resto: string[];
  select?: AnalyzerId[];
  locale: Locale;
  json: boolean;
  sarif?: string;
  /** Achado nesta severidade ou pior faz o processo sair com código 1. */
  failOn?: Severidade;
  noAi: boolean;
  yes: boolean;
  write: boolean;
  dryRun: boolean;
  all: boolean;
  severity?: Severidade;
  token?: string;
  descricao?: string;
}

export class ErroDeUso extends Error {}

/** `--only sast,sca` e `--only sast --only sca` significam a mesma coisa. */
function listaDeIds(valores: string[] | undefined, flag: string): AnalyzerId[] | undefined {
  if (!valores?.length) return undefined;
  const partes = valores.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  const invalidos = partes.filter((p) => !isAnalyzerId(p));
  if (invalidos.length) {
    // Erro de digitação em `--only` NÃO pode ser ignorado em silêncio: quem
    // escreveu `--only semgrep` receberia uma análise completa e concluiria
    // que a flag não funciona.
    throw new ErroDeUso(
      `${flag}: analisador desconhecido: ${invalidos.join(", ")}. Disponíveis: ${ANALYZER_IDS.join(", ")}.`
    );
  }
  return [...new Set(partes as AnalyzerId[])];
}

function severidade(v: string | undefined, flag: string): Severidade | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (!ORDEM_SEVERIDADE.includes(s as Severidade)) {
    throw new ErroDeUso(
      `${flag}: severidade desconhecida: ${v}. Use ${ORDEM_SEVERIDADE.join(", ")}.`
    );
  }
  return s as Severidade;
}

/** `a` é tão grave quanto `limiar`, ou pior? */
export function atingeLimiar(a: Severidade, limiar: Severidade): boolean {
  return ORDEM_SEVERIDADE.indexOf(a) <= ORDEM_SEVERIDADE.indexOf(limiar);
}

export interface ArquivoConfig {
  select?: string[];
  skip?: string[];
  locale?: string;
  failOn?: string;
  repo?: string;
}

/**
 * Lê `.starguard.json` da raiz informada. Ausente é o caso normal, não erro.
 * JSON quebrado, sim, é erro — silenciá-lo faria a configuração "não pegar"
 * sem ninguém saber por quê.
 */
export async function lerConfig(raiz: string): Promise<ArquivoConfig> {
  const caminho = resolve(raiz, ".starguard.json");
  const bruto = await readFile(caminho, "utf8").catch(() => null);
  if (bruto === null) return {};
  try {
    return JSON.parse(bruto) as ArquivoConfig;
  } catch (e) {
    throw new ErroDeUso(
      `.starguard.json inválido: ${(e as Error).message}`
    );
  }
}

const COMANDOS: Comando[] = [
  "scan",
  "skills",
  "fix",
  "doctor",
  "list",
  "login",
  "logout",
  "whoami",
  "hook",
  "help",
  "version",
];

export function parse(argv: string[]): Opcoes {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      only: { type: "string", multiple: true },
      skip: { type: "string", multiple: true },
      lang: { type: "string" },
      json: { type: "boolean", default: false },
      sarif: { type: "string" },
      "fail-on": { type: "string" },
      "no-ai": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      write: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      severity: { type: "string" },
      token: { type: "string" },
      description: { type: "string", short: "d" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.help) return base("help");
  if (values.version) return base("version");

  const primeiro = positionals[0];
  const comando: Comando =
    primeiro && (COMANDOS as string[]).includes(primeiro)
      ? (primeiro as Comando)
      : "scan";
  const resto = primeiro === comando ? positionals.slice(1) : positionals;

  const only = listaDeIds(values.only as string[] | undefined, "--only");
  const skip = listaDeIds(values.skip as string[] | undefined, "--skip");
  if (only && skip) {
    throw new ErroDeUso("--only e --skip não podem ser usados juntos.");
  }

  let select = only;
  if (skip) select = ANALYZER_IDS.filter((id) => !skip.includes(id));
  // `starguard skills a.md b.md` é atalho para `--only skills`; se a pessoa
  // combinou o atalho com `--only`, a flag explícita ganha.
  if (comando === "skills" && !select) select = ["skills"];

  function base(cmd: Comando): Opcoes {
    return {
      comando: cmd,
      alvo: ".",
      resto: [],
      locale: normalizeLocale(values.lang as string | undefined),
      json: !!values.json,
      noAi: !!values["no-ai"],
      yes: !!values.yes,
      write: !!values.write,
      dryRun: !!values["dry-run"],
      all: !!values.all,
    };
  }

  return {
    ...base(comando),
    // No `scan`, o primeiro argumento livre é o alvo. Nos outros comandos ele
    // significa outra coisa (arquivo de skill, id de achado) e o alvo continua
    // sendo o diretório atual.
    alvo: comando === "scan" && resto[0] ? resto[0] : ".",
    resto: comando === "scan" ? resto.slice(1) : resto,
    select,
    sarif: values.sarif as string | undefined,
    failOn: severidade(values["fail-on"] as string | undefined, "--fail-on"),
    severity: severidade(values.severity as string | undefined, "--severity"),
    token: (values.token as string | undefined) || process.env.GITHUB_TOKEN,
    descricao: values.description as string | undefined,
  };
}

/**
 * Funde a configuração do arquivo com as flags. A flag SEMPRE ganha — a
 * função só preenche o que ficou vazio.
 */
export function comConfig(op: Opcoes, cfg: ArquivoConfig): Opcoes {
  const out = { ...op };

  if (!out.select && (cfg.select?.length || cfg.skip?.length)) {
    const doArquivo = cfg.select?.filter(isAnalyzerId) as AnalyzerId[] | undefined;
    if (doArquivo?.length) out.select = doArquivo;
    else if (cfg.skip?.length) {
      const pular = new Set(cfg.skip);
      out.select = ANALYZER_IDS.filter((id) => !pular.has(id));
    }
  }
  if (!op.failOn && cfg.failOn) {
    out.failOn = severidade(cfg.failOn, ".starguard.json#failOn");
  }
  // O idioma da flag já passou por `normalizeLocale`, então não dá para saber
  // se veio de `--lang` ou do padrão. Só sobrescreve quando o arquivo diz algo
  // e a flag não foi usada.
  if (cfg.locale && !process.argv.includes("--lang")) {
    out.locale = normalizeLocale(cfg.locale);
  }
  return out;
}

/** Códigos de saída — é o que torna o comando utilizável em CI. */
export const SAIDA = {
  /** Nada acima do limiar. */
  limpo: 0,
  /** Achado que atinge `--fail-on`. Não é erro da ferramenta: é o trabalho dela. */
  achados: 1,
  /** A execução falhou (uso errado, repositório inacessível, binário ausente). */
  erro: 2,
} as const;
