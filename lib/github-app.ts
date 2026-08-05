// ============================================================
// O GitHub App da Starbridge.
//
// Por que App e não OAuth App ou token pessoal:
//
//  - É o único que RECEBE webhook. Os gatilhos que você pediu (PR aberto,
//    commit na main) são eventos que o GitHub empurra, e só um App os recebe.
//  - O token é de INSTALAÇÃO, vale uma hora e é gerado na hora. Nada de token
//    de trinta dias guardado no nosso banco.
//  - A permissão é por repositório e revogável de lá. Se um cliente desinstala
//    o App, o acesso morre no mesmo instante, sem depender de nós.
//  - Os PRs saem como `starguard[bot]`, não no nome de uma pessoa que um dia
//    sai da empresa e leva a automação junto.
//
// A chave privada do App é o segredo mais sensível do produto: com ela se
// forja acesso a todo repositório onde o App está instalado. Ela vive só em
// variável de ambiente, nunca no banco, e nunca é registrada em log.
//
// NODE-ONLY.
// ============================================================
import "server-only";
import { createSign, timingSafeEqual, createHmac } from "node:crypto";
import { log } from "@starguard/core/logger";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

/**
 * Configuração do App, se estiver completa.
 *
 * Devolve `null` em vez de lançar: uma instalação que não usa os gatilhos
 * automáticos é legítima, e o webhook responde 503 explicando em vez de o
 * processo morrer na subida.
 */
/**
 * Normaliza a chave privada, aceitando as QUATRO formas em que ela costuma
 * chegar. Isso não é generosidade: cada uma dessas formas aparece na prática, e
 * a falha de todas é idêntica e silenciosa — "o bot nunca responde".
 *
 *  1. PEM completo, com quebras de linha reais.
 *  2. PEM completo com `\n` literais (o que sobra quando se cola PEM num
 *     painel de variável de ambiente que não aceita multi-linha).
 *  3. O PEM inteiro em base64, numa linha só.
 *  4. **Só o miolo do PEM** — o base64 do DER, sem as linhas `BEGIN`/`END`.
 *     Acontece quando alguém copia "a chave" da tela e deixa o cabeçalho para
 *     trás. É base64 válido, decodifica para bytes válidos, e mesmo assim o
 *     `createSign` recusa: o erro que se vê é `DECODER routines::unsupported`,
 *     que não diz nada sobre cabeçalho faltando.
 *
 * No caso 4 não dá para saber pelo texto se o DER é PKCS#1 (`RSA PRIVATE KEY`,
 * o formato que o GitHub entrega) ou PKCS#8 (`PRIVATE KEY`). Em vez de
 * adivinhar pelo prefixo do base64 — que é heurística frágil —, montamos os
 * dois e deixamos o Node dizer qual carrega.
 */
export function normalizarChave(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;

  // 1 e 2 — já é PEM.
  if (v.includes("-----BEGIN")) return v.replace(/\\n/g, "\n");

  // 3 — PEM inteiro em base64.
  const decodificado = Buffer.from(v, "base64").toString("utf8");
  if (decodificado.includes("-----BEGIN")) return decodificado;

  // 4 — só o miolo. Remonta o PEM e testa qual rótulo o Node aceita.
  const corpo = v.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(corpo)) return null;

  const linhas = corpo.match(/.{1,64}/g)?.join("\n") ?? corpo;
  for (const rotulo of ["RSA PRIVATE KEY", "PRIVATE KEY"]) {
    const pem = `-----BEGIN ${rotulo}-----\n${linhas}\n-----END ${rotulo}-----\n`;
    try {
      // Assinar é o único teste que vale: se o Node consegue usar a chave, ela
      // está boa; qualquer verificação de formato feita por nós seria palpite.
      createSign("RSA-SHA256").update("teste").sign(pem);
      return pem;
    } catch {
      /* tenta o próximo rótulo */
    }
  }
  return null;
}

export function appConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  // `_FILE` é a forma menos sujeita a erro: aponta para o `.pem` baixado e
  // ninguém precisa colar nada. É também o padrão que orquestradores de
  // container usam para montar segredo como arquivo.
  const raw = process.env.GITHUB_APP_PRIVATE_KEY_FILE
    ? lerArquivoDeChave(process.env.GITHUB_APP_PRIVATE_KEY_FILE)
    : process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !webhookSecret || !raw) return null;

  const privateKey = normalizarChave(raw);
  if (!privateKey) return null;

  return { appId, privateKey, webhookSecret };
}

function lerArquivoDeChave(caminho: string): string | undefined {
  try {
    // `readFileSync` e não `promises`: `appConfig` é síncrona e chamada no
    // caminho do webhook, onde tornar tudo assíncrono por causa disto seria
    // espalhar `await` por seis funções para ler um arquivo de 1 kB.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:fs").readFileSync(caminho, "utf8") as string;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------
// Assinatura do webhook
// ------------------------------------------------------------

/**
 * O corpo veio mesmo do GitHub?
 *
 * Esta é a única barreira do webhook: a rota é pública por definição (o GitHub
 * não faz login). Sem ela, qualquer pessoa dispararia análises em nome de
 * qualquer repositório — gastando a IA da conta e abrindo PRs.
 *
 * Duas exigências, e as duas importam:
 *
 *  - **Sobre o corpo CRU.** Reserializar o JSON muda espaços e ordem de chave,
 *    e o HMAC deixa de bater. Por isso a rota lê `text()` e só depois parseia.
 *  - **Comparação em tempo constante.** Com `===`, o tempo de resposta vaza
 *    quantos bytes iniciais o atacante acertou, e a assinatura fica
 *    adivinhável byte a byte.
 */
export function verificarAssinatura(
  corpoCru: string,
  assinatura: string | null,
  secret: string
): boolean {
  if (!assinatura?.startsWith("sha256=")) return false;

  const esperado =
    "sha256=" + createHmac("sha256", secret).update(corpoCru, "utf8").digest("hex");

  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ------------------------------------------------------------
// Tokens
// ------------------------------------------------------------

function base64url(s: string | Buffer): string {
  return Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * JWT do App (RS256), assinado com a chave privada.
 *
 * Vale 10 minutos — é o máximo que o GitHub aceita, e serve só para trocar por
 * um installation token. Não dá acesso a repositório nenhum por si.
 *
 * `iat` recuado em 60 s de propósito: relógio adiantado no nosso servidor faz
 * o GitHub recusar com "issued at is in the future", e o sintoma é um webhook
 * que falha sem explicação aparente.
 */
export function appJwt(cfg: GitHubAppConfig): string {
  const agora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: agora - 60, exp: agora + 600, iss: cfg.appId })
  );
  const assinatura = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(cfg.privateKey);
  return `${header}.${payload}.${base64url(assinatura)}`;
}

interface TokenCacheado {
  token: string;
  expiraEm: number;
}

// Cache por instalação: o token vale uma hora, e pedir um novo a cada evento
// gastaria uma chamada de API por webhook sem necessidade.
const cache = new Map<number, TokenCacheado>();

/**
 * Token de INSTALAÇÃO — é este que fala com os repositórios.
 *
 * Vive uma hora. A margem de 5 minutos evita o caso em que o token expira no
 * meio de uma sequência de chamadas (ler o diff, commitar, abrir o PR) e a
 * última falha por segundos.
 */
export async function installationToken(installationId: number): Promise<string> {
  const cfg = appConfig();
  if (!cfg) throw new Error("GitHub App não configurado no servidor.");

  const hit = cache.get(installationId);
  if (hit && hit.expiraEm > Date.now() + 5 * 60_000) return hit.token;

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${appJwt(cfg)}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    }
  );

  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    // A mensagem NÃO repete o corpo inteiro: ele pode conter detalhe da
    // instalação que não precisa ir para o log.
    throw new Error(
      `Falha ao obter installation token (${res.status}): ${corpo.slice(0, 200)}`
    );
  }

  const j = (await res.json()) as { token: string; expires_at: string };
  cache.set(installationId, {
    token: j.token,
    expiraEm: new Date(j.expires_at).getTime(),
  });
  log.info("github.app.token", { engine: String(installationId) });
  return j.token;
}

/** Esquece os tokens em cache — usado quando uma instalação é removida. */
export function esquecerInstalacao(installationId: number): void {
  cache.delete(installationId);
}
