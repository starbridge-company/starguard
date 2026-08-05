// ============================================================
// Onde o terminal guarda a credencial.
//
// `~/.starguard/credentials.json`, com permissão `0600` — só o dono lê.
//
// Guarda SÓ o refresh token. O access dura 15 minutos e fica em memória: não
// há ganho em persistir algo que expira antes de a pessoa rodar o próximo
// comando, e todo segredo a menos no disco é um a menos para vazar.
//
// Limite honesto, escrito aqui porque não dá para resolver sem dependência: em
// Windows o modo do arquivo protege menos que num sistema POSIX (o controle
// real é a ACL do NTFS, e o Node não a ajusta). O chaveiro do sistema seria o
// certo, e exige binding nativo. Enquanto isso, a defesa que existe é a
// ROTAÇÃO: um refresh copiado deste arquivo derruba a sessão inteira assim que
// for usado, e o evento vai para a trilha de auditoria.
// ============================================================
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Credentials {
  /** Servidor a que este refresh pertence — trocar de servidor invalida tudo. */
  server: string;
  refreshToken: string;
  /** Só para exibir no `whoami` sem precisar de rede. */
  email?: string;
  savedAt: string;
}

export function credentialsPath(): string {
  return (
    process.env.STARGUARD_CREDENTIALS ||
    join(homedir(), ".starguard", "credentials.json")
  );
}

export async function loadCredentials(): Promise<Credentials | null> {
  const bruto = await readFile(credentialsPath(), "utf8").catch(() => null);
  if (bruto === null) return null;
  try {
    const c = JSON.parse(bruto) as Credentials;
    return c.refreshToken ? c : null;
  } catch {
    // Arquivo corrompido é o mesmo que não ter credencial: o comando pede
    // login de novo em vez de morrer com erro de parse.
    return null;
  }
}

export async function saveCredentials(c: Credentials): Promise<void> {
  const caminho = credentialsPath();
  await mkdir(dirname(caminho), { recursive: true, mode: 0o700 });
  // `mode` no `writeFile` só vale na CRIAÇÃO: se o arquivo já existir com
  // permissão larga, ele a mantém. O `chmod` depois é o que garante o 0600 nos
  // dois casos.
  await writeFile(caminho, JSON.stringify(c, null, 2), { mode: 0o600 });
  await chmod(caminho, 0o600).catch(() => {
    /* sistema sem suporte a modo POSIX: ver a nota do cabeçalho */
  });
}

export async function clearCredentials(): Promise<void> {
  await rm(credentialsPath(), { force: true });
}

/** Servidor do StarGuard. `--server` e a variável cobrem quem auto-hospeda. */
export function serverUrl(): string {
  return (
    process.env.STARGUARD_SERVER?.replace(/\/+$/, "") || "https://app.starguard.dev"
  );
}
