import { jsonOk } from "@/lib/http";
import { checkSchema, schemaMessage, MIGRATE_HINT } from "@/lib/schema-check";
import { checkBinaries } from "@starguard/core/binaries";
import { naFilaDeVagas, scanSlots, vagasEmUso } from "@starguard/core/scan-slot";
import { jobsAtivos, recolherAbandonados, totalDeJobs } from "@/lib/scan-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rota pública (allowlist no middleware) — não expõe segredos.
 *
 * Responde 503 quando o banco está atrás do código: era a informação que
 * faltava quando o login começou a devolver 500 sem explicação.
 * Ver AUDITORIA.md#ARQ-12.
 */
/**
 * Um health check que TRAVA é pior que um que responde mal.
 *
 * Medido contra a produção: `/api/health` não respondeu em 90 s. A causa é o
 * `checkSchema`, que consulta o banco — ele trata erro, mas não trata DEMORA, e
 * uma conexão pendurada espera para sempre. O efeito é o pior possível para esta
 * rota em particular: ela é a única fonte de verdade sobre o estado do servidor,
 * é o que o `starguard doctor` consulta e é o que o orquestrador usa para
 * decidir se manda tráfego. Sem resposta, quem está depurando não consegue
 * distinguir "o banco caiu" de "o servidor inteiro morreu" — e foi exatamente
 * essa distinção que faltou aqui.
 *
 * Com prazo, o pior caso vira uma resposta que diz `"unknown"` no lugar do que
 * não deu para medir. Uma resposta parcial e pontual vale mais que uma completa
 * que nunca chega.
 */
const PRAZO_CHECAGEM_MS = Number(process.env.HEALTH_TIMEOUT_MS) || 8_000;

function comPrazo<T>(promessa: Promise<T>, aoEstourar: T): Promise<T> {
  return Promise.race([
    promessa.catch(() => aoEstourar),
    new Promise<T>((r) => setTimeout(() => r(aoEstourar), PRAZO_CHECAGEM_MS)),
  ]);
}

export async function GET() {
  // O health check é o batimento mais frequente que esta instância tem. Usá-lo
  // para recolher jobs abandonados dá ao mecanismo uma segunda chance de rodar
  // mesmo quando ninguém está escaneando — que é justamente quando o resto de
  // um scan órfão fica pendurado ocupando a caixa. Ver `lib/scan-jobs.ts`.
  recolherAbandonados();

  const [schema, binaries] = await Promise.all([
    comPrazo(checkSchema(), {
      ok: false,
      expected: 0,
      applied: 0,
      pending: [],
      error: `Sem resposta do banco em ${PRAZO_CHECAGEM_MS} ms.`,
    }),
    comPrazo(checkBinaries(), []),
  ]);

  // Distinguimos "atrasado" de "inalcançável": são consertos diferentes.
  const db = schema.error ? "unreachable" : "ok";
  // Scanner exigido e ausente não derruba a fase (UX-15), mas produz um scan
  // que não escaneia — quem opera precisa ver isso aqui, não num relatório
  // vazio que parece repositório limpo.
  const faltando = binaries.filter((b) => b.required && !b.present);

  const body = {
    status: schema.ok && faltando.length === 0 ? "ok" : "degraded",
    db,
    schema: {
      ok: schema.ok,
      expected: schema.expected,
      applied: schema.applied,
      pending: schema.pending,
    },
    scanners: binaries,
    /**
     * O estado da fila, em números.
     *
     * Existe porque "está lento" e "está cheio" pedem consertos diferentes, e
     * até aqui não havia como distinguir os dois de fora. `slots` é quanto a
     * caixa comporta, `busy` quanto está em uso e `waiting` quantos esperam
     * vaga — os três contando também os scans do painel web, que passam pelo
     * mesmo portão. `jobs` é o mapa da extensão. Ver AUDITORIA.md#ARQ-16.
     */
    scan: {
      slots: scanSlots(),
      busy: vagasEmUso(),
      waiting: naFilaDeVagas(),
      jobs: totalDeJobs(),
      activeJobs: jobsAtivos(),
    },
    message: schemaMessage(schema),
    ...(schema.ok ? {} : { hint: MIGRATE_HINT }),
    ...(faltando.length
      ? {
          scannersMessage: `Scanner(s) configurado(s) mas ausente(s) no host: ${faltando
            .map((b) => b.configured)
            .join(", ")}. O scan roda e não encontra nada.`,
        }
      : {}),
  };

  // 503 e não 500: é estado do ambiente, não defeito da aplicação — e é o que
  // um health check de orquestrador entende como "não me mande tráfego".
  return jsonOk(body, schema.ok ? 200 : 503);
}
