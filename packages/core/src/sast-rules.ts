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
