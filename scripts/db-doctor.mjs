#!/usr/bin/env node
// ============================================================
// Por que a conexão com o Postgres não acontece — camada a camada.
//
// Existe por causa do deploy de 07/08/2026 no servidor dedicado. O log tinha
// isto, e só isto, a cada 15 segundos:
//
//   Failed query: UPDATE starguard.jobs SET … ← Connection terminated due to
//   connection timeout ← Connection terminated unexpectedly
//
// Vinte linhas de SQL para dizer "não conectei". A informação que decide o
// conserto — o nome resolveu? o pacote chegou? o Postgres respondeu? — não
// estava em lugar nenhum, e o `pg` não a separa: DNS errado, firewall e senha
// errada saem todos como "Connection terminated".
//
// Aqui elas são separadas, porque cada uma manda em um lugar diferente:
//
//   DNS falhou           -> o contêiner não está na rede do banco (nem chega perto)
//   TCP deu timeout      -> pacote DESCARTADO: rede errada ou firewall
//   TCP foi recusado     -> a máquina responde, mas nada escuta nessa porta
//   handshake recusado   -> chegou no Postgres: é credencial, base ou SSL
//   consulta falhou      -> conectou: é permissão ou schema
//
// Rode DE DENTRO do contêiner — é o ponto de vista que importa; do seu laptop
// a resposta seria sobre outra rede:
//
//   docker exec -it <container> node scripts/db-doctor.mjs
//   npm run db:doctor        (local)
// ============================================================
import "./load-env.mjs";
import net from "node:net";
import dns from "node:dns/promises";
import pg from "pg";

/** Prazo de cada camada. Curto de propósito: isto é diagnóstico, não retry. */
const PRAZO_MS = Number(process.env.DB_DOCTOR_TIMEOUT_MS || 5_000);

let houveFalha = false;

function ok(texto) {
  console.log(`  ok   ${texto}`);
}

function falha(texto, ...conserto) {
  houveFalha = true;
  console.log(`  FALHA ${texto}`);
  for (const linha of conserto) console.log(`        -> ${linha}`);
}

function titulo(n, texto) {
  console.log(`\n${n}. ${texto}`);
}

// ---- 1. DATABASE_URL ----
titulo(1, "DATABASE_URL");

const bruta = process.env.DATABASE_URL;
if (!bruta) {
  falha(
    "ausente",
    "No Coolify: Environment Variables do recurso. Ela NÃO é herdada do projeto sozinha.",
    "Formato: postgres://usuario:senha@host:5432/banco"
  );
  process.exit(1);
}

let url;
try {
  url = new URL(bruta);
} catch {
  falha(
    "ilegível",
    "Senha com @ ou / precisa de encodeURIComponent — é o erro mais comum aqui.",
    "Confira também aspas sobrando: DATABASE_URL=\"postgres://…\" no painel vira parte do valor."
  );
  process.exit(1);
}

const host = url.hostname;
const porta = Number(url.port || 5432);
const banco = url.pathname.replace(/^\//, "") || "(padrão)";
// Sem credencial: esta saída acaba colada em chamado e em log.
ok(`${host}:${porta}/${banco}  (usuário: ${url.username || "(não informado)"})`);

if (host === "localhost" || host === "127.0.0.1") {
  console.log(
    "        ! dentro de um contêiner, localhost é o PRÓPRIO contêiner — não o host.\n" +
      "          Postgres rodando na máquina hospedeira quer host.docker.internal\n" +
      "          (com extra_hosts) ou o IP da bridge; Postgres em outro contêiner\n" +
      "          quer o NOME DO SERVIÇO."
  );
}

// ---- 2. DNS ----
titulo(2, `DNS: o nome "${host}" resolve?`);

const ehIp = net.isIP(host) !== 0;
let enderecos = [];
if (ehIp) {
  enderecos = [host];
  ok("é um IP literal — nada a resolver");
} else {
  try {
    const achados = await dns.lookup(host, { all: true });
    enderecos = achados.map((a) => a.address);
    ok(`${host} -> ${enderecos.join(", ")}`);
  } catch (e) {
    falha(
      `${host} não resolve (${e.code || e.message})`,
      "Este contêiner não enxerga esse nome. Num compose, só há resolução entre serviços da MESMA rede.",
      "No Coolify: o recurso precisa estar na mesma rede do banco (Connect To Predefined Network),",
      "ou o banco precisa estar declarado no mesmo docker-compose.",
      "Confira também erro de digitação no nome do serviço."
    );
    console.log("\nSem DNS não há o que testar adiante.");
    process.exit(1);
  }
}

// ---- 3. TCP ----
titulo(3, `TCP: o pacote chega em ${host}:${porta}?`);

const tcp = await new Promise((resolve) => {
  const socket = new net.Socket();
  const encerrar = (r) => {
    socket.destroy();
    resolve(r);
  };
  socket.setTimeout(PRAZO_MS);
  socket.once("connect", () => encerrar({ estado: "conectou" }));
  socket.once("timeout", () => encerrar({ estado: "timeout" }));
  socket.once("error", (e) => encerrar({ estado: "erro", code: e.code, message: e.message }));
  socket.connect(porta, host);
});

if (tcp.estado === "conectou") {
  ok(`porta ${porta} aberta e aceitando conexão`);
} else if (tcp.estado === "timeout") {
  falha(
    `sem resposta em ${PRAZO_MS} ms — o pacote foi DESCARTADO`,
    "É ISTO que produz «Connection terminated due to connection timeout» no app.",
    "Descartado ≠ recusado: não é o Postgres que está no chão, é o pacote que não chega.",
    "Causas, em ordem de frequência: (a) contêiner fora da rede do banco;",
    "(b) firewall do host (ufw/iptables) barrando a faixa do Docker;",
    "(c) o endereço é público e o provedor bloqueia 5432 de fora.",
    "Teste de fora do contêiner, no host:  nc -vz " + host + " " + porta
  );
} else if (tcp.code === "ECONNREFUSED") {
  falha(
    `conexão RECUSADA em ${porta}`,
    "A máquina existe e respondeu — só não há nada escutando nessa porta.",
    "Postgres parado, porta diferente da configurada, ou listen_addresses só em localhost."
  );
} else {
  falha(`${tcp.code || "erro"}: ${tcp.message}`);
}

if (tcp.estado !== "conectou") {
  console.log("\nSem TCP não há handshake para testar.");
  process.exit(1);
}

// ---- 4. Handshake do Postgres ----
titulo(4, "Postgres: autenticação e base");

const client = new pg.Client({
  connectionString: bruta,
  connectionTimeoutMillis: PRAZO_MS,
});

try {
  await client.connect();
  ok("autenticado");
} catch (e) {
  // O código do Postgres é o que separa os casos; a mensagem varia por versão.
  const conserto = {
    "28P01": ["Senha errada para o usuário " + url.username + "."],
    "28000": ["pg_hba.conf não aceita este usuário/origem. É o caso clássico de", "conexão vinda da faixa do Docker sem regra correspondente."],
    "3D000": [`A base "${banco}" não existe. Crie-a, ou corrija o nome na DATABASE_URL.`],
  }[e.code] || [
    e.message,
    // Um Postgres que EXIGE SSL e um cliente que não o oferece morrem aqui, sem
    // código: a conexão simplesmente cai depois do TCP ter dado certo.
    "Se o servidor exige TLS, acrescente ?sslmode=require ao fim da DATABASE_URL.",
  ];
  falha(`recusado no handshake${e.code ? ` (${e.code})` : ""}`, ...conserto);
  await client.end().catch(() => {});
  process.exit(1);
}

// ---- 5. Consulta e schema ----
titulo(5, "Consulta e schema");

try {
  const { rows } = await client.query("select current_user, current_database(), version()");
  ok(`select 1 respondeu — usuário ${rows[0].current_user}, base ${rows[0].current_database}`);
} catch (e) {
  falha(`a conexão abriu mas a consulta falhou: ${e.message}`);
}

try {
  const { rows } = await client.query(
    "select count(*)::int as n from drizzle.__drizzle_migrations"
  );
  ok(`${rows[0].n} migração(ões) aplicada(s)`);
} catch (e) {
  if (e.code === "42P01" || e.code === "3F000") {
    falha(
      "as migrações NUNCA rodaram neste banco",
      "O banco responde, mas está vazio — o app vai subir e recusar login com 503.",
      "Conserto: RUN_MIGRATIONS=true no ambiente do contêiner (o entrypoint aplica na subida),",
      "ou uma vez à mão:  docker exec -it <container> node scripts/migrate.mjs"
    );
  } else {
    falha(`não deu para ler as migrações: ${e.message}`);
  }
}

await client.end().catch(() => {});

console.log(
  houveFalha
    ? "\nResultado: há o que consertar acima."
    : "\nResultado: o caminho até o banco está inteiro."
);
process.exit(houveFalha ? 1 : 0);
