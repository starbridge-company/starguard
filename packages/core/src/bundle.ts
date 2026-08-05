// ============================================================
// Empacota o que precisa ser escaneado — AUDITORIA.md#ARQ-14.
//
// Existe porque a análise passou a poder acontecer NO SERVIDOR. Quem usa a
// extensão do VS Code não instala `opengrep` nem `trivy`: a máquina que tem os
// binários é a nossa, e para isso os arquivos precisam viajar.
//
// **Isso é uma decisão de privacidade, não um detalhe de transporte.** Até
// aqui o código-fonte nunca saía da máquina de quem programa; agora sai, e por
// isso o transporte remoto exige consentimento explícito e o servidor descarta
// tudo assim que o scanner termina. Ver `scan-transport.ts`.
//
// O que se manda depende do que se vai procurar, e a diferença é enorme:
//
//   `sca` — só MANIFESTOS e lockfiles. O Trivy resolve CVE a partir da árvore
//           declarada de dependências; ele não olha o seu código. São alguns
//           kilobytes, e nenhuma linha escrita por você sai da máquina.
//
//   `sast` — código-fonte. Não tem como ser diferente: é o código que está
//           sendo analisado. Vai com teto de arquivos e de bytes.
//
// Essa separação é o ponto: quem quer só saber de CVE nas dependências não
// precisa mandar código nenhum, e a interface deixa isso explícito.
// ============================================================
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

export interface ArquivoEmpacotado {
  path: string;
  content: string;
}

export interface Pacote {
  files: ArquivoEmpacotado[];
  /** Quantos arquivos elegíveis existiam antes do teto. */
  discovered: number;
  /** Quantos ficaram de fora. Nunca some em silêncio — ver UX-15. */
  truncated: number;
  bytes: number;
}

const PULAR = new Set([
  "node_modules", ".git", ".next", ".turbo", ".cache", "dist", "build", "out",
  "coverage", "vendor", "__pycache__", ".venv", "venv", "target", "bin", "obj",
  ".idea", ".vscode-test", "tmp", "temp",
]);

const EXT_FONTE = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rb",
  ".php", ".cs", ".rs", ".sql", ".sol", ".kt", ".scala", ".vue", ".svelte",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".swift", ".m", ".ex", ".exs", ".dart",
  ".sh", ".bash", ".tf", ".yaml", ".yml",
]);

/**
 * Os arquivos que declaram dependência, por ecossistema.
 *
 * É a lista que o Trivy sabe ler em modo `fs`. Mandar só isto é o que permite
 * escanear CVE **sem enviar código nenhum** — e é por isso que ela é explícita
 * em vez de "tudo que parece configuração".
 */
const MANIFESTOS = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock", "pyproject.toml",
  "go.mod", "go.sum",
  "Cargo.toml", "Cargo.lock",
  "pom.xml", "build.gradle", "build.gradle.kts", "gradle.lockfile",
  "Gemfile", "Gemfile.lock",
  "composer.json", "composer.lock",
  "packages.config", "packages.lock.json",
  "mix.lock", "pubspec.lock", "conan.lock",
]);

function ehManifesto(nome: string): boolean {
  return MANIFESTOS.has(nome) || /\.(csproj|fsproj|vbproj)$/i.test(nome);
}

export interface OpcoesDePacote {
  /** Teto de arquivos. O excesso é contado, não escondido. */
  maxFiles?: number;
  /** Teto por arquivo — um fonte gerado de 2 MB não ajuda ninguém. */
  perFileBytes?: number;
  /** Teto do pacote inteiro. Precisa caber no limite do corpo da requisição. */
  totalBytes?: number;
}

/**
 * Junta os arquivos para o analisador pedido.
 *
 * A ordem da coleta importa quando o teto aperta: arquivos menores primeiro,
 * porque cabem mais — e cobertura ampla vale mais que profundidade num
 * scanner de padrão, que olha arquivo a arquivo.
 */
export async function empacotarParaScan(
  raiz: string,
  alvo: "sast" | "sca",
  opcoes: OpcoesDePacote = {}
): Promise<Pacote> {
  const maxFiles = opcoes.maxFiles ?? (alvo === "sca" ? 200 : 1200);
  const perFileBytes = opcoes.perFileBytes ?? 512 * 1024;
  const totalBytes = opcoes.totalBytes ?? (alvo === "sca" ? 4 : 12) * 1024 * 1024;

  const candidatos: { path: string; abs: string; size: number }[] = [];

  async function andar(dir: string, rel: string, fundo: number): Promise<void> {
    // Trava de profundidade: um `node_modules` mal nomeado ou um link
    // circular não pode transformar isto numa varredura infinita.
    if (fundo > 20 || candidatos.length > 20_000) return;
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const abs = join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (PULAR.has(e.name) || e.name.startsWith(".")) continue;
        await andar(abs, relPath, fundo + 1);
        continue;
      }
      if (!e.isFile()) continue; // link simbólico não entra: pode sair da raiz

      const querido =
        alvo === "sca"
          ? ehManifesto(e.name)
          : EXT_FONTE.has(extname(e.name).toLowerCase()) &&
            !/\.min\.(js|css)$/i.test(e.name) &&
            !/\.d\.ts$/i.test(e.name);
      if (!querido) continue;

      let size = 0;
      try {
        size = (await stat(abs)).size;
      } catch {
        continue;
      }
      if (size === 0 || size > perFileBytes) continue;
      candidatos.push({ path: relPath, abs, size });
    }
  }

  await andar(raiz, "", 0);
  candidatos.sort((a, b) => a.size - b.size);

  const files: ArquivoEmpacotado[] = [];
  let bytes = 0;
  for (const c of candidatos) {
    if (files.length >= maxFiles || bytes + c.size > totalBytes) break;
    try {
      const content = await readFile(c.abs, "utf8");
      // Binário disfarçado de texto: o byte nulo é o sinal barato e confiável.
      if (content.includes("\u0000")) continue;
      files.push({ path: c.path, content });
      bytes += c.size;
    } catch {
      /* ilegível: segue */
    }
  }

  return {
    files,
    discovered: candidatos.length,
    truncated: Math.max(0, candidatos.length - files.length),
    bytes,
  };
}
