// ============================================================
// Confere a configuração do GitHub App — `npm run check:github-app`.
//
// Existe porque os modos de falha desta configuração são todos SILENCIOSOS: um
// App ID errado, um PEM com as quebras estragadas pelo painel de variáveis, ou
// um segredo de webhook que não bate produzem exatamente o mesmo sintoma — "o
// bot nunca responde". Descobrir isso pelo silêncio custa horas.
//
// O script vai até o GitHub: assina o JWT, pergunta quem é o App e lista as
// instalações. Se chegou até aí, a configuração está boa.
// ============================================================
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const VERDE = "\x1b[32m";
const VERMELHO = "\x1b[31m";
const CINZA = "\x1b[90m";
const RESET = "\x1b[0m";

const ok = (s) => console.log(`  ${VERDE}✔${RESET} ${s}`);
const erro = (s) => console.log(`  ${VERMELHO}✖${RESET} ${s}`);
const nota = (s) => console.log(`    ${CINZA}${s}${RESET}`);

function base64url(v) {
  return Buffer.from(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

console.log("\n  StarGuard · GitHub App\n");

const appId = process.env.GITHUB_APP_ID;
const segredo = process.env.GITHUB_WEBHOOK_SECRET;
const bruto = process.env.GITHUB_APP_PRIVATE_KEY;

let falhou = false;

if (!appId) {
  erro("GITHUB_APP_ID ausente");
  nota("Está na tela do App, logo abaixo do nome. É um número.");
  falhou = true;
} else if (!/^\d+$/.test(appId.trim())) {
  erro(`GITHUB_APP_ID não parece um número: "${appId}"`);
  nota("Cuidado: o App ID NÃO é o Client ID (que começa com 'Iv1.').");
  falhou = true;
} else {
  ok(`GITHUB_APP_ID = ${appId}`);
}

if (!segredo) {
  erro("GITHUB_WEBHOOK_SECRET ausente");
  nota("Sem ele o webhook responde 503 — e é a ÚNICA barreira daquela rota.");
  falhou = true;
} else if (segredo.length < 16) {
  erro("GITHUB_WEBHOOK_SECRET curto demais");
  nota("Gere um forte: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  falhou = true;
} else {
  ok(`GITHUB_WEBHOOK_SECRET = ${segredo.length} caracteres`);
}

/**
 * Aceita as quatro formas em que a chave costuma chegar — ver a explicação
 * completa em `lib/github-app.ts`. Repetida aqui de propósito: este script roda
 * ANTES de a app subir e não deve depender do TypeScript compilado.
 */
function normalizarChave(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes("-----BEGIN")) return v.replace(/\\n/g, "\n");

  const decodificado = Buffer.from(v, "base64").toString("utf8");
  if (decodificado.includes("-----BEGIN")) return decodificado;

  // Só o miolo do PEM: remonta e deixa o Node dizer qual rótulo carrega.
  const corpo = v.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(corpo)) return null;
  const linhas = corpo.match(/.{1,64}/g)?.join("\n") ?? corpo;
  for (const rotulo of ["RSA PRIVATE KEY", "PRIVATE KEY"]) {
    const pem = `-----BEGIN ${rotulo}-----\n${linhas}\n-----END ${rotulo}-----\n`;
    try {
      createSign("RSA-SHA256").update("teste").sign(pem);
      return pem;
    } catch {
      /* tenta o próximo rótulo */
    }
  }
  return null;
}

let chave = null;
const caminhoDaChave = process.env.GITHUB_APP_PRIVATE_KEY_FILE;
let origem = bruto;

if (caminhoDaChave) {
  try {
    origem = readFileSync(caminhoDaChave, "utf8");
  } catch {
    erro(`GITHUB_APP_PRIVATE_KEY_FILE aponta para um arquivo ilegível`);
    nota(caminhoDaChave);
    origem = undefined;
  }
}

if (!origem) {
  if (!caminhoDaChave) {
    erro("GITHUB_APP_PRIVATE_KEY ausente");
    nota("Baixe o .pem em 'Private keys' na tela do App.");
    nota("O jeito menos sujeito a erro: GITHUB_APP_PRIVATE_KEY_FILE=C:/caminho/chave.pem");
  }
  falhou = true;
} else {
  chave = normalizarChave(origem);
  if (!chave) {
    erro("GITHUB_APP_PRIVATE_KEY não pôde ser interpretada como chave RSA");
    // Diagnóstico específico: um erro genérico obriga a adivinhar qual das
    // quatro formas está errada.
    const v = origem.trim();
    nota(`Recebi ${v.length} caracteres começando com "${v.slice(0, 16)}…"`);
    if (v.length < 300 && /[/\\]/.test(v)) {
      nota("Isto parece um CAMINHO, não o conteúdo do arquivo.");
      nota("Para apontar um caminho, use GITHUB_APP_PRIVATE_KEY_FILE.");
    } else if (!v.includes("BEGIN")) {
      nota("Falta o cabeçalho -----BEGIN ... PRIVATE KEY-----.");
      nota("Tentei remontá-lo e o Node ainda recusou — o conteúdo está incompleto.");
      nota("Copie o .pem INTEIRO, do BEGIN ao END, ou use _FILE.");
    }
    falhou = true;
  } else {
    const rotulo = chave.match(/-----BEGIN ([A-Z ]+)-----/)?.[1] ?? "?";
    ok(`Chave privada carregada (${rotulo})${caminhoDaChave ? " · de arquivo" : ""}`);
  }
}

if (falhou || !chave) {
  console.log(`\n  ${VERMELHO}Configuração incompleta.${RESET} Veja o .env.example.\n`);
  process.exit(1);
}

// ---- Assina o JWT e pergunta ao GitHub ----
let jwt;
try {
  const agora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: agora - 60, exp: agora + 600, iss: appId }));
  const assinatura = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(chave);
  jwt = `${header}.${payload}.${base64url(assinatura)}`;
  ok("JWT assinado com a chave privada");
} catch (e) {
  erro(`Não foi possível assinar com esta chave: ${e.message}`);
  nota("O PEM provavelmente está truncado ou com as quebras de linha erradas.");
  nota("Alternativa: guarde-o em base64 — base64 -w0 chave.pem");
  process.exit(1);
}

const cabecalhos = {
  authorization: `Bearer ${jwt}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};

const app = await fetch("https://api.github.com/app", { headers: cabecalhos }).catch(
  (e) => ({ ok: false, status: 0, _erro: e.message })
);

if (!app.ok) {
  erro(`O GitHub recusou o JWT (HTTP ${app.status})`);
  if (app.status === 401) {
    nota("Ou o App ID não corresponde a esta chave privada, ou a chave foi revogada.");
    nota("Confira que os dois vieram do MESMO App.");
  }
  process.exit(1);
}

const dados = await app.json();
ok(`App reconhecido: ${dados.name} (@${dados.owner?.login})`);

// ---- Permissões: é aqui que a maioria dos problemas mora ----
const p = dados.permissions ?? {};
const exigidas = [
  ["contents", "write", "clonar, criar branch e commitar a correção"],
  ["pull_requests", "write", "ler os arquivos do PR e abrir o PR de correções"],
  ["metadata", "read", "obrigatória pelo GitHub"],
];

for (const [nome, nivel, motivo] of exigidas) {
  const atual = p[nome];
  const suficiente = nivel === "read" ? !!atual : atual === "write";
  if (suficiente) ok(`Permissão ${nome}: ${atual}`);
  else {
    erro(`Permissão ${nome} = ${atual ?? "nenhuma"} (precisa de ${nivel})`);
    nota(`Para: ${motivo}`);
    falhou = true;
  }
}

// ---- Eventos ----
const eventos = dados.events ?? [];
for (const e of ["pull_request", "push"]) {
  if (eventos.includes(e)) ok(`Evento assinado: ${e}`);
  else {
    erro(`Evento NÃO assinado: ${e}`);
    nota("Sem ele o gatilho correspondente simplesmente nunca dispara.");
    falhou = true;
  }
}

// ---- Instalações ----
const inst = await fetch("https://api.github.com/app/installations", { headers: cabecalhos });
if (inst.ok) {
  const lista = await inst.json();
  if (!lista.length) {
    erro("O App não está instalado em nenhuma conta");
    nota(`Instale em: https://github.com/apps/${dados.slug}/installations/new`);
    falhou = true;
  } else {
    for (const i of lista) {
      const alvo =
        i.repository_selection === "all"
          ? "todos os repositórios"
          : `${i.repositories_url ? "repositórios selecionados" : "?"}`;
      ok(`Instalado em @${i.account?.login} (${alvo}) · id ${i.id}`);
    }
  }
}

console.log(
  falhou
    ? `\n  ${VERMELHO}Ajuste os itens acima e rode de novo.${RESET}\n`
    : `\n  ${VERDE}Tudo certo.${RESET} O webhook deve responder 202 no próximo evento.\n`
);
process.exit(falhou ? 1 : 0);
