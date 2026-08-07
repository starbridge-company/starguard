// ============================================================
// Aviso de subida: o banco está atrás do código? Ver AUDITORIA.md#ARQ-12.
//
// Aqui só AVISA. Quem realmente recusa subir é `scripts/check-schema.mjs`, no
// `prestart` — script Node puro, fora do empacotador.
//
// O motivo é concreto: `instrumentation.ts` é compilado para os dois runtimes
// (node e edge) e arrasta o que importa junto. Um `process.exit` neste módulo
// fazia o bundler acusar "Node.js API não suportada no Edge Runtime" a cada
// recompilação, mesmo protegido por `if` — a checagem dele é estática. Entre
// esconder a chamada do analisador e movê-la para a camada certa, a segunda é
// a honesta: derrubar processo é trabalho de script de inicialização, não de
// hook de framework.
//
// A rede de proteção em runtime continua: /api/health responde 503 e o login
// devolve 503 com texto acionável em vez de 500 mudo.
// ============================================================
import "server-only";
import { checkSchema, schemaMessage } from "@/lib/schema-check";
import { alvoDoBanco } from "@/lib/db";

/**
 * A frase que diz PARA ONDE olhar, escolhida pelo erro.
 *
 * Uma dica genérica seria quase inútil aqui, e uma dica ERRADA é pior que
 * nenhuma: mandar conferir firewall quando a senha está errada custa a mesma
 * hora que o silêncio custava, com a desvantagem de parecer informação.
 *
 * As quatro respostas são realmente diferentes, e o erro já distingue as quatro
 * — só ninguém estava lendo. `descreverErro`, em `schema-check.ts`, é o que faz
 * a causa chegar até aqui; sem ela todo caso caía no ramo genérico, porque a
 * mensagem era o SQL do Drizzle.
 */
export function dicaDeConexao(erro: string): string {
  if (/timeout|ETIMEDOUT|EHOSTUNREACH/i.test(erro)) {
    return "«timeout» é pacote DESCARTADO, não porta fechada: o Postgres pode estar ótimo. Confira se ESTE contêiner alcança esse endereço (mesma rede Docker? firewall do host?).";
  }
  if (/ECONNREFUSED/i.test(erro)) {
    return "«recusado» é o contrário de timeout: a máquina respondeu, só não há nada escutando nessa porta. Postgres parado, porta trocada, ou listen_addresses só em localhost.";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(erro)) {
    return "O NOME não resolve: este contêiner não está na rede onde esse serviço existe. Num compose, só há resolução entre serviços da mesma rede.";
  }
  if (/28P01|28000|authentication|password|3D000|does not exist/i.test(erro)) {
    return "A conexão CHEGOU no Postgres — o problema é credencial, base ou pg_hba. Rede está bem; não perca tempo nela.";
  }
  return "Confira DATABASE_URL e se este contêiner alcança esse endereço.";
}

export async function verifySchemaOnBoot(): Promise<void> {
  if (process.env.SCHEMA_CHECK === "off") return;
  if (!process.env.DATABASE_URL) return;

  const status = await checkSchema(true);
  if (status.ok) return;

  // ---- Banco INALCANÇÁVEL: uma linha, na subida, dizendo PARA ONDE ----
  //
  // Aqui havia `return` — silêncio de propósito, com o argumento de que
  // oscilação de rede na subida não deve alarmar. O deploy de 07/08/2026
  // mostrou o preço: o processo subiu, o healthcheck respondeu 503, o Coolify
  // reverteu, e a única pista no log era o worker repetindo vinte linhas de SQL
  // a cada 15 segundos — sem nunca dizer que endereço não respondia.
  //
  // O medo de alarme falso é legítimo e continua atendido: isto sai UMA vez,
  // no boot, não a cada volta do laço. E não é ruído — se o banco não responde
  // na subida, login, fila e análise já estão todos fora do ar.
  if (status.error) {
    console.error(
      `\n[starguard] Banco INALCANÇÁVEL em ${alvoDoBanco()}: ${status.error}\n` +
        "[starguard] O servidor subiu e responde HTTP, mas login, fila e análises vão falhar até isso ser resolvido.\n" +
        `[starguard] ${dicaDeConexao(status.error)}\n` +
        "[starguard] Diagnóstico camada a camada: node scripts/db-doctor.mjs\n"
    );
    return;
  }

  console.error(
    `\n[starguard] ${schemaMessage(status)}\n` +
      "[starguard] A aplicação subiu, mas o login vai recusar (503) até isso ser resolvido.\n"
  );
}
