import { jsonOk } from "@/lib/http";
import {
  checkSchema,
  schemaMessage,
  MIGRATE_HINT,
  EXPECTED_MIGRATIONS,
} from "@/lib/schema-check";
import { checkBinaries, type BinaryStatus } from "@starguard/core/binaries";
import { naFilaDeVagas, scanSlots, vagasEmUso } from "@starguard/core/scan-slot";
import { limitesDaCaixa } from "@starguard/core/container";
import { jobsAtivos, recolherAbandonados, totalDeJobs } from "@/lib/scan-jobs";
import { processInstance } from "@/lib/process-instance";

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
/**
 * Função, e não constante de módulo — mesma razão do `aiHttp()`: uma constante
 * é congelada na avaliação do módulo, e um teste que precise encurtar o prazo
 * teria de reimportar a rota inteira para consegui-lo. Aqui isso é mais que
 * conveniência: sem poder encurtá-lo, o caminho do prazo ESTOURADO — que é
 * justamente o que a produção exercita — só seria testável esperando 8 s.
 */
function prazoDeChecagem(): number {
  return Number(process.env.HEALTH_TIMEOUT_MS) || 8_000;
}

function comPrazo<T>(promessa: Promise<T>, aoEstourar: T): Promise<T> {
  const relogio = prazoDeChecagem();
  return Promise.race([
    promessa.catch(() => aoEstourar),
    new Promise<T>((r) => setTimeout(() => r(aoEstourar), relogio)),
  ]);
}

/**
 * VIVACIDADE ≠ PRONTIDÃO, e confundir as duas trava o deploy.
 *
 * Esta rota, do jeito que estava, respondia por prontidão: 503 enquanto o banco
 * não estivesse alcançável e em dia. Como sinal para um orquestrador que
 * distribui tráfego entre réplicas, está certo — e continua sendo o que ela faz
 * abaixo. Como `HEALTHCHECK` de contêiner, está errado, e o preço é alto: o
 * Coolify usa o healthcheck do Docker como PORTÃO do rolling update. Contêiner
 * que não fica saudável é revertido.
 *
 * O que aconteceu em produção (07/08/2026, servidor dedicado):
 *
 *   [entrypoint] StarGuard subindo em 0.0.0.0:3003
 *   ✓ Ready in 307ms
 *   worker.loop.failed … Connection terminated due to connection timeout
 *   Attempt 1..5 of 5 | Healthcheck logs: curl: (22) … returned error: 503
 *   New container is not healthy, rolling back to the old container.
 *
 * O processo estava DE PÉ e servindo HTTP — quem respondeu 503 foi ele mesmo,
 * corretamente, dizendo "não alcanço o Postgres". A reversão não conserta nada:
 * o contêiner velho tem o mesmo problema, porque o problema não está na imagem.
 * E o efeito colateral é o pior: enquanto o banco estiver fora, NENHUM deploy
 * consegue entrar — nem o que conserta a configuração.
 *
 * O mesmo laço fecha em servidor novo, sem banco fora do ar: schema não
 * migrado ⇒ `ok: false` ⇒ 503 ⇒ o primeiro deploy nunca sobe.
 *
 * Por isso a vivacidade é uma sonda separada, que NÃO toca no banco: ela
 * responde "este processo está servindo HTTP", que é a única pergunta que o
 * healthcheck do contêiner sabe usar. A prontidão continua inteira em
 * `GET /api/health` — é o que o `starguard doctor`, a extensão e quem estiver
 * depurando consultam, e é lá que o 503 tem significado.
 */
function vivacidade(): Response {
  return jsonOk({ status: "live" }, 200);
}

function memoriaDoProcesso() {
  const m = process.memoryUsage();
  const mb = (n: number) => Number((n / (1024 * 1024)).toFixed(1));
  return {
    rssMb: mb(m.rss),
    heapUsedMb: mb(m.heapUsed),
    heapTotalMb: mb(m.heapTotal),
    externalMb: mb(m.external),
    arrayBuffersMb: mb(m.arrayBuffers),
  };
}

export async function GET(req: Request) {
  // `?probe=live` antes de qualquer coisa: nada abaixo desta linha pode entrar
  // no caminho de uma sonda que existe justamente para não depender de nada.
  if (new URL(req.url).searchParams.get("probe") === "live") return vivacidade();

  // O health check é o batimento mais frequente que esta instância tem. Usá-lo
  // para recolher jobs abandonados dá ao mecanismo uma segunda chance de rodar
  // mesmo quando ninguém está escaneando — que é justamente quando o resto de
  // um scan órfão fica pendurado ocupando a caixa. Ver `lib/scan-jobs.ts`.
  recolherAbandonados();

  const [schema, binaries] = await Promise.all([
    comPrazo(checkSchema(), {
      ok: false,
      // O journal está no bundle mesmo quando o banco não responde. Zero aqui
      // parecia dizer "não existem migrations"; o que não sabemos é apenas
      // quantas o banco aplicou.
      expected: EXPECTED_MIGRATIONS,
      applied: null,
      pending: [],
      error: `Sem resposta do banco em ${prazoDeChecagem()} ms.`,
    }),
    // `null`, e NÃO `[]`, quando o prazo estoura.
    //
    // Lista vazia é indistinguível de "conferi e está tudo certo" — e era
    // exatamente isso que a rota respondia. Medido contra a produção, na
    // primeira requisição depois de a instância acordar:
    //
    //   {"status":"ok", …, "scanners":[], "scan":{"slots":1,…}}
    //
    // Luz verde com ZERO conhecimento sobre os scanners, no único momento em
    // que alguém consulta esta rota — quando desconfia que algo está errado. E
    // não é acaso que estoure ali: a caixa tem meia CPU, e a primeira execução
    // do opengrep ainda paga a auto-extração dele.
    //
    // "Não consegui verificar" é uma resposta legítima; "está tudo bem" quando
    // não se olhou, não é. Ver AUDITORIA.md#BUG-26.
    comPrazo<BinaryStatus[] | null>(checkBinaries(), null),
  ]);

  // Distinguimos "atrasado" de "inalcançável": são consertos diferentes.
  const db = schema.error ? "unreachable" : "ok";
  // Scanner exigido e ausente não derruba a fase (UX-15), mas produz um scan
  // que não escaneia — quem opera precisa ver isso aqui, não num relatório
  // vazio que parece repositório limpo.
  //
  // **Ausente e "não respondeu" são separados**, e não por preciosismo: os dois
  // saíam com a mesma frase — "configurado mas ausente no host" — e ela mandava
  // quem opera conferir uma instalação que estava perfeita. O que havia era a
  // máquina ocupada com o nosso próprio scan. Ver o cabeçalho de `binaries.ts`.
  //
  // `binaries === null` = o prazo estourou e NÃO se sabe nada. É diferente de
  // "conferi e está tudo certo", e a diferença aparece no `status`.
  const naoVerificado = binaries === null;
  const exigidos = (binaries ?? []).filter((b) => b.required && !b.present);
  const faltando = exigidos.filter((b) => b.reason !== "busy");
  const semResposta = exigidos.filter((b) => b.reason === "busy");

  const body = {
    // Não conferir é motivo para NÃO dizer "ok". Um orquestrador que lê esta
    // rota precisa poder confiar no verde; um verde que às vezes significa
    // "não olhei" não serve para decidir nada.
    status: schema.ok && faltando.length === 0 && !naoVerificado ? "ok" : "degraded",
    db,
    schema: {
      ok: schema.ok,
      expected: schema.expected,
      applied: schema.applied,
      pending: schema.pending,
    },
    // `null` viaja como `null`: quem consome vê "não sei", não "nada a relatar".
    scanners: binaries,
    process: processInstance(),
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
      memory: memoriaDoProcesso(),
      /**
       * De ONDE saiu o `slots` acima — ver `limitesDaCaixa()` no núcleo.
       *
       * `slots: 1` sozinho não responde nada: pode ser cota de CPU do
       * contêiner, `SCAN_SLOTS`/`SAST_JOBS` fixados em 1 no painel (herança do
       * DEPLOY.md escrito para a instância de meia CPU) ou uma máquina de um
       * núcleo. São três consertos diferentes, e a pergunta que este campo
       * responde é literalmente "por que o scan demora tanto no servidor
       * dedicado?" — que não tinha como ser respondida de fora.
       */
      box: limitesDaCaixa(),
    },
    message: schemaMessage(schema),
    // Uma dica errada custa mais que nenhuma. Quando o banco não responde,
    // `db:migrate` só repete a mesma falha; a ação é corrigir rede/credencial.
    // A dica de migração existe apenas quando conseguimos consultar a tabela e
    // provar que o journal está atrás.
    ...(schema.ok || schema.error ? {} : { hint: MIGRATE_HINT }),
    ...(naoVerificado
      ? {
          scannersMessage: `Não deu para verificar os scanners em ${prazoDeChecagem()} ms. Isto NÃO quer dizer que estão ausentes — numa instância pequena a primeira sondagem depois de acordar pode passar do prazo. Consulte de novo em alguns segundos.`,
        }
      : {}),
    ...(faltando.length
      ? {
          scannersMessage: `Scanner(s) configurado(s) mas ausente(s) no host: ${faltando
            .map((b) => b.configured)
            .join(", ")}. O scan roda e não encontra nada.`,
        }
      : {}),
    // Não entra em `scannersMessage` porque não é o mesmo problema e não tem a
    // mesma resposta: aqui não há nada a instalar — a máquina estava ocupada
    // quando perguntamos, e a análise segue rodando normalmente.
    ...(semResposta.length
      ? {
          scannersBusyMessage: `Scanner(s) sem resposta na sondagem (máquina ocupada): ${semResposta
            .map((b) => `${b.configured}${b.detail ? ` — ${b.detail}` : ""}`)
            .join(", ")}. Não é ausência: a análise continua usando-os.`,
        }
      : {}),
  };

  // 503 e não 500: é estado do ambiente, não defeito da aplicação — e é o que
  // um health check de orquestrador entende como "não me mande tráfego".
  return jsonOk(body, schema.ok ? 200 : 503);
}
