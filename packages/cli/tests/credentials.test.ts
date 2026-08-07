// ============================================================
// Credencial no disco — AUDITORIA.md#SEC-10.
//
// O arquivo guarda um refresh token de trinta dias. A permissão `0600` é a
// única barreira que existe entre ele e outro usuário da mesma máquina, e
// permissão é o tipo de coisa que se quebra sem ninguém notar: basta alguém
// trocar `writeFile` por outro caminho de escrita.
//
// Vale registrar o limite, porque ele não se resolve com teste: em Windows o
// modo POSIX protege menos (o controle real é a ACL do NTFS). A defesa que
// funciona nos dois sistemas é a ROTAÇÃO — um refresh copiado daqui derruba a
// sessão inteira assim que for usado.
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearCredentials,
  credentialsPath,
  loadCredentials,
  saveCredentials,
  serverUrl,
} from "../src/credentials";

let dir = "";
const ENV_ANTERIOR = process.env.STARGUARD_CREDENTIALS;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sg-cred-"));
  process.env.STARGUARD_CREDENTIALS = join(dir, "sub", "credentials.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  if (ENV_ANTERIOR === undefined) delete process.env.STARGUARD_CREDENTIALS;
  else process.env.STARGUARD_CREDENTIALS = ENV_ANTERIOR;
});

const cred = {
  server: "https://exemplo.starguard",
  refreshToken: "refresh-abc",
  savedAt: new Date(0).toISOString(),
};

describe("gravação", () => {
  it("cria o arquivo e o diretório que faltar", async () => {
    await saveCredentials(cred);
    expect(await loadCredentials()).toMatchObject({ refreshToken: "refresh-abc" });
  });

  it.runIf(process.platform !== "win32")(
    "o arquivo fica com permissão 0600",
    async () => {
      // Só o dono lê. Em Windows o modo POSIX não é aplicado, então o caso é
      // pulado em vez de asseverar algo falso — a nota do cabeçalho explica
      // qual é a defesa que vale ali.
      await saveCredentials(cred);
      const s = await stat(credentialsPath());
      expect(s.mode & 0o777).toBe(0o600);
    }
  );

  it.runIf(process.platform !== "win32")(
    "REAPERTA a permissão de um arquivo que já existia largo",
    async () => {
      // `mode` no `writeFile` só vale na CRIAÇÃO. Sem o `chmod` depois, um
      // arquivo criado antes com 0644 continuaria legível por todos — e o
      // sintoma seria invisível.
      const caminho = credentialsPath();
      await saveCredentials(cred);
      await rm(caminho);
      await writeFile(caminho, "{}", { mode: 0o644 });

      await saveCredentials(cred);
      const s = await stat(caminho);
      expect(s.mode & 0o777).toBe(0o600);
    }
  );

  it("sobrescreve o refresh anterior (é o que a rotação faz)", async () => {
    await saveCredentials(cred);
    await saveCredentials({ ...cred, refreshToken: "refresh-novo" });
    expect((await loadCredentials())?.refreshToken).toBe("refresh-novo");
  });

  it("não grava o access token", async () => {
    // O access dura 15 min: persistir algo que expira antes do próximo comando
    // é só mais um segredo em disco para vazar.
    await saveCredentials(cred);
    const bruto = await readFile(credentialsPath(), "utf8");
    expect(bruto).not.toMatch(/access/i);
  });
});

describe("leitura", () => {
  it("arquivo ausente devolve null — não derruba o comando", async () => {
    expect(await loadCredentials()).toBeNull();
  });

  it("JSON corrompido devolve null em vez de explodir", async () => {
    // Pedir login de novo é melhor que morrer com erro de parse num arquivo
    // que a pessoa nem sabe que existe.
    await saveCredentials(cred);
    await writeFile(credentialsPath(), "{ não é json");
    expect(await loadCredentials()).toBeNull();
  });

  it("JSON válido SEM refresh token também é null", async () => {
    await saveCredentials(cred);
    await writeFile(credentialsPath(), JSON.stringify({ server: "x" }));
    expect(await loadCredentials()).toBeNull();
  });
});

describe("remoção", () => {
  it("apaga o arquivo", async () => {
    await saveCredentials(cred);
    await clearCredentials();
    expect(await loadCredentials()).toBeNull();
  });

  it("apagar o que não existe não é erro", async () => {
    await expect(clearCredentials()).resolves.toBeUndefined();
  });
});

describe("servidor", () => {
  it("respeita STARGUARD_SERVER e remove a barra final", () => {
    const anterior = process.env.STARGUARD_SERVER;
    process.env.STARGUARD_SERVER = "https://meu.servidor/";
    expect(serverUrl()).toBe("https://meu.servidor");
    if (anterior === undefined) delete process.env.STARGUARD_SERVER;
    else process.env.STARGUARD_SERVER = anterior;
  });

  it("a credencial guarda a QUE servidor pertence", async () => {
    // Um refresh só vale no servidor que o emitiu. Sem esse campo, apontar o
    // CLI para outra instância mandaria a credencial de uma para a outra.
    await saveCredentials(cred);
    expect((await loadCredentials())?.server).toBe("https://exemplo.starguard");
  });
});

// ============================================================
// O terminal e a extensão têm de apontar para o MESMO servidor.
//
// Existia um desvio silencioso: o padrão do terminal era
// `https://app.starguard.dev` — um domínio **que nunca existiu**, inventado
// quando o cliente nasceu — enquanto a extensão apontava para o servidor real.
// Quem rodasse `starguard login` sem configurar nada batia num endereço que
// não resolve, e o erro falava de rede, não de configuração.
//
// Sobreviveu porque nada comparava os dois. A extensão já tinha um teste
// travando `SERVIDOR_PADRAO` contra o `default` do manifesto; faltava a outra
// ponta. Este arquivo é a ponte, e é o que faz a próxima troca de domínio
// falhar aqui em vez de na máquina de quem usa.
// ============================================================
describe("o padrão do terminal acompanha o da extensão", () => {
  const raiz = join(import.meta.dirname, "..", "..");
  const configDaExtensao = readFileSync(
    join(raiz, "vscode", "src", "config.ts"),
    "utf8"
  );
  const daExtensao = configDaExtensao.match(/SERVIDOR_PADRAO = "([^"]+)"/)?.[1];

  it("os dois clientes falam com o mesmo endereço", () => {
    delete process.env.STARGUARD_SERVER;
    expect(daExtensao).toBeTruthy();
    expect(serverUrl()).toBe(daExtensao);
  });

  it("é HTTPS — o token de acesso viaja por aí", () => {
    delete process.env.STARGUARD_SERVER;
    expect(serverUrl()).toMatch(/^https:\/\//);
  });

  it("não termina em barra: o cliente concatena `/api/...` direto", () => {
    delete process.env.STARGUARD_SERVER;
    expect(serverUrl().endsWith("/")).toBe(false);
  });
});
