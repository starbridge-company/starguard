// ============================================================
// `starguard` — o StarGuard no terminal.
//
// O mesmo motor do painel web, sem servidor e sem banco: o orquestrador roda
// aqui dentro, os analisadores são os mesmos objetos, e a correção sai do
// `Fixer` embutido em cada um. O que este arquivo faz é traduzir comando de
// terminal em plano de execução e desfecho em código de saída.
//
// A escolha do que rodar é a razão de existir do comando:
//
//   starguard scan .                   tudo o que der
//   starguard scan . --only sca        só as dependências
//   starguard skills ./skill.md        só a skill, sem repositório nenhum
//   starguard fix F-12 --write         corrige um achado, no disco
//
// NODE-ONLY.
// ============================================================
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { analyze, plan as montarPlano } from "@starguard/core";
import { allAnalyzers, getAnalyzer } from "@starguard/core/registry";
import { openWorkspace } from "@starguard/core/workspace";
import { probeBinary, clearProbeCache } from "@starguard/core/binaries";
import { hasAnyAiKey } from "@starguard/core/ai";
import { looksLikeUrl } from "@starguard/core/repo-url";
import { ENGINES, BIN, aiFor } from "@starguard/core/config";
import { toSarif } from "@starguard/core/export";
import { translate } from "@starguard/core/i18n/translate";
import type { MessageKey } from "@starguard/core/i18n/messages";
import type { Locale } from "@starguard/core/i18n/config";
import { reasonKey } from "@starguard/core/compat";
import type {
  AnalysisRun,
  FixContext,
  FixableFinding,
  Workspace,
  WorkspaceSource,
} from "@starguard/core/contracts";
import { atingeLimiar, comConfig, lerConfig, parse, ErroDeUso, SAIDA, type Opcoes } from "./args.js";
import { achadosDe, tabelaDeAchados, ttySink, type AchadoPlano } from "./render.js";
import { c, mostrarCursor } from "./tty.js";
import { accessTokenAtual, login } from "./login.js";
import { clearCredentials, loadCredentials, serverUrl } from "./credentials.js";
import { conteudoDoHook, instalarHook, removerHook } from "./hook.js";
import { setAiTransport } from "@starguard/core/ai-transport";

function texto(locale: Locale) {
  return (k: MessageKey, v?: Record<string, string | number>) =>
    translate(locale, k, v);
}

/** O alvo é uma URL de repositório ou um diretório no disco? */
function origem(alvo: string, token?: string): WorkspaceSource {
  if (looksLikeUrl(alvo)) return { type: "git", url: alvo, token };
  return { type: "local", path: resolve(alvo) };
}

function nomeDoProjeto(alvo: string): string {
  return looksLikeUrl(alvo) ? alvo.replace(/^https?:\/\//, "") : basename(resolve(alvo));
}

// ------------------------------------------------------------
// scan
// ------------------------------------------------------------

async function comandoScan(op: Opcoes): Promise<number> {
  const t = texto(op.locale);
  const src = origem(op.alvo, op.token);

  // As skills entram por arquivo: no terminal não há formulário para colar
  // conteúdo, e mandar a pessoa passar texto por flag seria pior que ler o
  // arquivo que ela já tem.
  const skills = await lerSkills(op.resto);

  const execPlan = await montarPlano({
    select: op.select,
    source: src,
    locale: op.locale,
    systemDescription: op.descricao,
    skills,
  });

  // `--json` e `--sarif` são consumidos por máquina: desenho vivo no meio do
  // stdout quebraria o parse do outro lado.
  const paraMaquina = op.json || !!op.sarif;
  const sinks = paraMaquina ? [] : [ttySink(op.locale, nomeDoProjeto(op.alvo))];

  const run = await analyze({
    ...execPlan,
    select: op.select,
    source: src,
    locale: op.locale,
    systemDescription: op.descricao,
    skills,
    sinks,
  });

  const achados = achadosDe(run);

  if (op.json) {
    // Chaves em inglês e estáveis: quem consome JSON é um pipeline, e mudar as
    // chaves conforme o idioma quebraria o consumidor do outro lado. Mesma
    // decisão já fixada em `tests/export.test.ts` para a exportação do painel.
    process.stdout.write(JSON.stringify(saidaJson(run, achados), null, 2) + "\n");
  } else if (op.sarif) {
    await writeFile(op.sarif, JSON.stringify(sarifDe(run), null, 2), "utf8");
    process.stdout.write(`${t("cli.sarifWritten", { file: op.sarif })}\n`);
  } else {
    process.stdout.write(tabelaDeAchados(achados, op.locale));
    process.stdout.write(resumo(run, achados, op));
  }

  return codigoDeSaida(run, achados, op);
}

async function lerSkills(caminhos: string[]) {
  if (!caminhos.length) return undefined;
  const lidas = await Promise.all(
    caminhos.map(async (p) => {
      const content = await readFile(resolve(p), "utf8").catch(() => null);
      // Arquivo ilegível é erro de uso, e dizer QUAL falhou é o que torna a
      // mensagem acionável.
      if (content === null) throw new ErroDeUso(`Não foi possível ler: ${p}`);
      return { name: basename(p), content };
    })
  );
  return lidas;
}

function saidaJson(run: AnalysisRun, achados: AchadoPlano[]) {
  return {
    ok: run.ok,
    durationMs: run.finishedAt - run.startedAt,
    analyzers: Object.fromEntries(
      Object.values(run.outcomes).map((o) => [
        o.id,
        {
          status: o.status,
          reason: o.reason,
          error: o.error,
          // A degradação viaja no JSON: um pipeline que só olha `findings`
          // precisa poder descobrir que o resultado saiu com menos contexto.
          degraded: o.degraded,
          durationMs:
            o.startedAt && o.finishedAt ? o.finishedAt - o.startedAt : undefined,
        },
      ])
    ),
    findings: achados.map(({ raw: _raw, ...f }) => f),
  };
}

function sarifDe(run: AnalysisRun) {
  const scan = {
    sast: {
      engine: ENGINES.sast,
      ran: run.outcomes.sast?.status === "done",
      vulnerabilities: (run.outcomes.sast?.result as never[]) ?? [],
    },
    sca: {
      engine: ENGINES.sca,
      ran: run.outcomes.sca?.status === "done",
      dependencies: (run.outcomes.sca?.result as never[]) ?? [],
    },
    review: run.outcomes.business?.result as never,
  };
  return toSarif(scan as never);
}

function resumo(run: AnalysisRun, achados: AchadoPlano[], op: Opcoes): string {
  const t = texto(op.locale);
  const linhas: string[] = [];

  const contagem = achados.reduce<Record<string, number>>((a, f) => {
    a[f.severity] = (a[f.severity] ?? 0) + 1;
    return a;
  }, {});
  const partes = ["critical", "high", "medium", "low", "info"]
    .filter((s) => contagem[s])
    .map((s) => `${contagem[s]} ${s}`);

  if (partes.length) linhas.push("  " + c.bold(partes.join("  ·  ")));

  const comErro = Object.values(run.outcomes).filter((o) => o.status === "error");
  for (const o of comErro) {
    linhas.push("  " + c.red(`✖ ${o.id}: ${o.error?.split("\n")[0]}`));
  }

  if (op.failOn) {
    const acima = achados.filter((f) => atingeLimiar(f.severity, op.failOn!));
    linhas.push(
      acima.length
        ? "  " + c.red(t("cli.failOnHit", { n: acima.length, sev: op.failOn }))
        : "  " + c.green(t("cli.failOnClear", { sev: op.failOn }))
    );
  }

  return linhas.length ? "\n" + linhas.join("\n") + "\n" : "";
}

/**
 * O código de saída é o que torna o comando utilizável em CI.
 *
 * Achado NÃO é falha da ferramenta — é o trabalho dela. Por isso `1` (achados)
 * é separado de `2` (a execução quebrou): um pipeline que trata qualquer
 * não-zero como quebra ainda funciona, e um que quer distinguir consegue.
 */
function codigoDeSaida(run: AnalysisRun, achados: AchadoPlano[], op: Opcoes): number {
  const falhou = Object.values(run.outcomes).some((o) => o.status === "error");
  if (falhou && !op.failOn) return SAIDA.erro;
  if (op.failOn && achados.some((f) => atingeLimiar(f.severity, op.failOn!))) {
    return SAIDA.achados;
  }
  return falhou ? SAIDA.erro : SAIDA.limpo;
}

// ------------------------------------------------------------
// fix
// ------------------------------------------------------------

async function comandoFix(op: Opcoes): Promise<number> {
  const t = texto(op.locale);
  const src = origem(op.alvo, op.token);

  // Corrigir exige achar de novo: o terminal não guarda estado entre execuções
  // (não há banco), então o `fix` roda o scan e trabalha sobre o resultado.
  // É mais lento que consultar um id gravado, e é honesto — o arquivo pode ter
  // mudado desde o último scan, e corrigir por um id velho aplicaria a
  // correção na linha errada.
  const run = await analyze({
    select: op.select,
    source: src,
    locale: op.locale,
    systemDescription: op.descricao,
    sinks: [ttySink(op.locale, nomeDoProjeto(op.alvo))],
  });

  const todos = achadosDe(run);
  const alvos = escolherAlvos(todos, op);
  if (!alvos.length) {
    process.stdout.write("\n  " + c.yellow(t("cli.fix.noTarget")) + "\n");
    return SAIDA.limpo;
  }

  const ws = await openWorkspace(src);
  try {
    let aplicadas = 0;
    for (const achado of alvos) {
      const analyzer = getAnalyzer(achado.analyzer)!;
      const fixer = analyzer.fix;
      if (!fixer) {
        process.stdout.write(
          `  ${c.gray("–")} ${achado.id}: ${t("cli.fix.noFixer")}\n`
        );
        continue;
      }

      const finding: FixableFinding = {
        id: achado.id,
        analyzer: achado.analyzer,
        ruleId: achado.ruleId,
        title: achado.title,
        severity: achado.severity,
        file: achado.file,
        line: achado.line,
        description: achado.description,
        suggestion: achado.suggestion,
        codeSnippet: achado.codeSnippet,
        cwe: achado.cwe,
        raw: achado.raw,
      };

      const pode = fixer.can(finding);
      if (!pode.ok) {
        process.stdout.write(
          `  ${c.gray("–")} ${achado.id}: ${t(pode.reasonKey)}\n`
        );
        continue;
      }

      process.stdout.write(`  ${c.cyan("→")} ${achado.file}  ${c.gray(achado.ruleId)}\n`);

      const ctx: FixContext = {
        workspace: ws,
        locale: op.locale,
        repoUrl: ws?.origin?.url,
        token: op.token,
      };
      const proposta = await fixer.propose(finding, ctx);

      if (proposta.noChange) {
        process.stdout.write(`    ${c.yellow(t("cli.fix.noChange"))}\n`);
        continue;
      }

      process.stdout.write(`    ${proposta.explanation}\n`);
      for (const seguimento of proposta.followUp ?? []) {
        // O aviso do lockfile: a ferramenta edita o manifesto e NÃO regera o
        // lock. Engolir isso entrega um repositório que não instala.
        process.stdout.write(
          `    ${c.yellow("!")} ${t(seguimento.commandKey, {
            cmd: seguimento.command ?? "",
            manifest: achado.file,
            lockfile: "",
          })}\n`
        );
      }

      // `--dry-run` é o padrão: gravar no código de alguém sem pedir seria a
      // última coisa que uma ferramenta de segurança deveria fazer.
      if (!op.write) {
        process.stdout.write(`    ${c.gray(t("cli.fix.dryRun"))}\n`);
        continue;
      }
      if (!ws) {
        process.stdout.write(`    ${c.red(t("fix.cannot.noWorkspace"))}\n`);
        continue;
      }
      await fixer.apply(proposta, ws);
      aplicadas++;
      process.stdout.write(`    ${c.green(t("cli.fix.applied"))}\n`);
    }

    if (aplicadas) {
      process.stdout.write("\n  " + c.green(t("cli.fix.total", { n: aplicadas })) + "\n");
    }
    return SAIDA.limpo;
  } finally {
    await ws?.dispose();
  }
}

function escolherAlvos(todos: AchadoPlano[], op: Opcoes): AchadoPlano[] {
  if (op.resto.length) {
    const ids = new Set(op.resto);
    return todos.filter((f) => ids.has(f.id));
  }
  if (op.all) {
    return op.severity
      ? todos.filter((f) => atingeLimiar(f.severity, op.severity!))
      : todos;
  }
  // Sem id e sem `--all`: o mais grave, e só ele. Corrigir tudo por engano
  // custaria uma chamada de IA por achado.
  return todos.slice(0, 1);
}

// ------------------------------------------------------------
// login · logout · whoami
// ------------------------------------------------------------

async function comandoLogin(op: Opcoes): Promise<number> {
  const t = texto(op.locale);
  process.stdout.write("\n  " + t("cli.login.opening") + "\n");

  const r = await login({
    imprimir: (url) => {
      // A URL é impressa SEMPRE, não só quando o navegador falha: em SSH,
      // container ou WSL o `xdg-open` pode "funcionar" sem abrir nada, e aí a
      // pessoa fica olhando um terminal parado sem saber o que fazer.
      process.stdout.write("  " + c.gray(t("cli.login.orOpen")) + "\n");
      process.stdout.write("  " + c.cyan(url) + "\n\n");
    },
  }).catch((e: Error) => {
    process.stderr.write("\n  " + c.red(e.message) + "\n\n");
    return null;
  });
  if (!r) return SAIDA.erro;

  const quem = await consultarConta(r.accessToken);
  process.stdout.write(
    "  " + c.green("✔") + " " + t("cli.login.done", { email: quem ?? "?" }) + "\n\n"
  );
  return SAIDA.limpo;
}

async function comandoLogout(op: Opcoes): Promise<number> {
  const t = texto(op.locale);
  await clearCredentials();
  // A credencial local some, mas a SESSÃO no servidor continua até expirar ou
  // ser revogada. Dizer isso importa: quem faz logout porque desconfia de
  // vazamento precisa saber que o passo que resolve é revogar na tela de Conta.
  process.stdout.write("\n  " + t("cli.logout.done") + "\n");
  process.stdout.write("  " + c.gray(t("cli.logout.hint")) + "\n\n");
  return SAIDA.limpo;
}

async function comandoWhoami(op: Opcoes): Promise<number> {
  const t = texto(op.locale);
  const cred = await loadCredentials();
  if (!cred) {
    process.stdout.write("\n  " + c.yellow(t("cli.whoami.anonymous")) + "\n\n");
    return SAIDA.erro;
  }

  const token = await accessTokenAtual();
  if (!token) {
    // Refresh recusado: sessão revogada, senha trocada, ou reuso detectado.
    // Em qualquer um dos casos a saída é a mesma — entrar de novo.
    process.stdout.write("\n  " + c.red(t("cli.whoami.expired")) + "\n\n");
    return SAIDA.erro;
  }

  const quem = await consultarConta(token);
  process.stdout.write(
    "\n  " + c.green("✔") + " " + t("cli.whoami.as", { email: quem ?? "?" }) + "\n"
  );
  process.stdout.write("  " + c.gray(cred.server) + "\n\n");
  return SAIDA.limpo;
}

/** Quem é o dono do token, segundo o servidor. */
async function consultarConta(accessToken: string): Promise<string | null> {
  const res = await fetch(`${serverUrl()}/api/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = (await res.json().catch(() => null)) as { email?: string } | null;
  return j?.email ?? null;
}

// ------------------------------------------------------------
// hook
// ------------------------------------------------------------

async function comandoHook(op: Opcoes): Promise<number> {
  const t = texto(op.locale);
  const acao = op.resto[0] ?? "install";
  const raiz = resolve(op.alvo);

  const r =
    acao === "uninstall" || acao === "remove"
      ? await removerHook(raiz)
      : await instalarHook(raiz, await conteudoDoHook());

  if (r.ok) {
    process.stdout.write(`\n  ${c.green("✔")} ${t(`cli.hook.${r.acao}`)}\n`);
    process.stdout.write(`  ${c.gray(r.caminho)}\n`);
    if (r.acao !== "removido") {
      // O comportamento padrão é AVISAR, não bloquear. Quem quiser bloquear
      // precisa dizer — e precisa saber que existe a opção.
      process.stdout.write(`\n  ${c.gray(t("cli.hook.blockHint"))}\n`);
    }
    process.stdout.write("\n");
    return SAIDA.limpo;
  }

  const motivos: Record<string, string> = {
    nao_e_repo: t("cli.hook.notARepo"),
    hook_de_terceiro: t("cli.hook.foreign", { path: r.caminho ?? "" }),
    nao_instalado: t("cli.hook.notInstalled"),
  };
  process.stderr.write(`\n  ${c.red(motivos[r.motivo] ?? r.motivo)}\n\n`);
  return SAIDA.erro;
}

// ------------------------------------------------------------
// doctor · list
// ------------------------------------------------------------

async function comandoDoctor(op: Opcoes): Promise<number> {
  const t = texto(op.locale);
  clearProbeCache();

  const linhas: string[] = ["", "  " + c.bold("StarGuard · doctor"), ""];

  const binarios = [
    { rotulo: "SAST", engine: ENGINES.sast, bin: BIN[ENGINES.sast as keyof typeof BIN] },
    { rotulo: "SCA", engine: ENGINES.sca, bin: BIN.trivy },
  ];

  for (const b of binarios) {
    if (b.engine === "none") {
      linhas.push(`  ${c.gray("–")} ${b.rotulo.padEnd(6)} ${c.gray(t("analyzer.reason.engine_off"))}`);
      continue;
    }
    const r = await probeBinary(b.bin!);
    if (r.present) {
      linhas.push(`  ${c.green("✔")} ${b.rotulo.padEnd(6)} ${b.bin}  ${c.gray(r.version ?? "")}`);
      continue;
    }
    // O motivo REAL, e não "não encontrado" para tudo.
    //
    // O `doctor` é a primeira coisa que alguém roda quando a análise não sai, e
    // até aqui ele respondia "instale o opengrep" para três situações
    // diferentes — inclusive para a máquina que tem o opengrep instalado e
    // estava apenas ocupada. Mandar reinstalar o que já está lá é o pior
    // conselho que esta tela pode dar. Ver `binaries.ts`.
    const chave =
      r.reason === "spawn_failed"
        ? "analyzer.reason.spawn_failed"
        : r.reason === "busy"
          ? "cli.doctor.binBusy"
          : "analyzer.reason.binary_missing";
    // "ocupado" é aviso, não falha: o binário está lá e a análise vai usá-lo.
    const marca = r.reason === "busy" ? c.yellow("!") : c.red("✖");
    const texto = t(chave, { bin: b.bin! });
    linhas.push(
      `  ${marca} ${b.rotulo.padEnd(6)} ${r.reason === "busy" ? c.yellow(texto) : c.red(texto)}`
    );
    if (r.detail) linhas.push(`    ${c.gray(r.detail)}`);
  }

  const cred = await loadCredentials();
  if (cred) {
    linhas.push(
      `  ${c.green("✔")} ${"IA".padEnd(6)} ${t("cli.doctor.aiRemote", { server: cred.server })}`
    );
  } else if (hasAnyAiKey()) {
    linhas.push(
      `  ${c.green("✔")} ${"IA".padEnd(6)} ${t("cli.doctor.aiLocal")} · ${aiFor("business").model}`
    );
  } else {
    linhas.push(
      `  ${c.yellow("!")} ${"IA".padEnd(6)} ${c.yellow(t("cli.doctor.aiNone"))}`
    );
  }

  linhas.push("", "  " + c.bold(t("cli.doctor.analyzers")), "");

  // O diagnóstico por analisador sai do MESMO `probe` que o plano usa — não é
  // uma segunda opinião que pode divergir da primeira.
  const execPlan = await montarPlano({
    source: { type: "local", path: resolve(op.alvo) },
    systemDescription: "presente",
    skills: [{ name: "presente", content: "presente" }],
    locale: op.locale,
  });

  for (const e of execPlan.entries) {
    const nome = t(`analyzer.${e.id}.name` as MessageKey);
    linhas.push(
      e.willRun
        ? `  ${c.green("✔")} ${nome.padEnd(28)} ${c.gray(e.detail ?? "")}`
        : `  ${c.red("✖")} ${nome.padEnd(28)} ${c.red(t(reasonKey(e.reason!), { bin: e.detail ?? "" }))}`
    );
  }

  linhas.push("");
  process.stdout.write(linhas.join("\n") + "\n");

  const faltando = execPlan.entries.filter((e) => !e.willRun && e.reason !== "no_input");
  return faltando.length ? SAIDA.erro : SAIDA.limpo;
}

function comandoList(op: Opcoes): number {
  const t = texto(op.locale);
  const linhas = ["", "  " + c.bold(t("cli.list.title")), ""];

  for (const a of allAnalyzers()) {
    const precisa = [
      a.needs.workspace ? t("select.needsRepo") : "",
      a.fix ? t("select.fixes") : "",
    ]
      .filter(Boolean)
      .join(" · ");
    linhas.push(
      `  ${c.cyan(a.id.padEnd(10))} ${t(`analyzer.${a.id}.name` as MessageKey).padEnd(28)} ${c.gray(precisa)}`
    );
    linhas.push(`  ${" ".repeat(10)} ${c.gray(t(`analyzer.${a.id}.desc` as MessageKey))}`);
    linhas.push("");
  }

  process.stdout.write(linhas.join("\n"));
  return SAIDA.limpo;
}

function comandoAjuda(op: Opcoes): number {
  process.stdout.write("\n" + texto(op.locale)("cli.help") + "\n");
  return SAIDA.limpo;
}

// ------------------------------------------------------------
// Ponto de entrada
// ------------------------------------------------------------

/**
 * Liga a IA pela CONTA quando há login — e só então.
 *
 * A escolha não é automática por conveniência: no transporte remoto o trecho
 * de código SAI da máquina. Fazer login é o ato explícito que autoriza isso, e
 * `--no-ai` continua desligando tudo. Sem login, segue valendo a chave local:
 * quem nunca entrou não tem o comportamento alterado por baixo.
 */
async function configurarIa(op: Opcoes): Promise<void> {
  if (op.noAi) return;
  const cred = await loadCredentials();
  if (!cred) return;

  setAiTransport({
    kind: "remote",
    baseUrl: cred.server,
    // Função, e não string: o access dura 15 min e uma análise longa atravessa
    // a expiração. `accessTokenAtual` renova (e rotaciona) sob demanda.
    getToken: () => accessTokenAtual(),
  });
}

export async function main(argv: string[]): Promise<number> {
  let op: Opcoes;
  try {
    op = parse(argv);
    const raiz = looksLikeUrl(op.alvo) ? process.cwd() : resolve(op.alvo);
    op = comConfig(op, await lerConfig(raiz));
  } catch (e) {
    if (e instanceof ErroDeUso) {
      process.stderr.write(c.red(`\n  ${e.message}\n\n`));
      return SAIDA.erro;
    }
    throw e;
  }

  // `--no-ai` desliga os analisadores que dependem de modelo. Não é o mesmo
  // que apagar a chave: o `probe` deles passa a responder "sem chave" e eles
  // saem do plano COM motivo, como qualquer outro indisponível.
  if (op.noAi) {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  }

  // Depois do `--no-ai` ter sido aplicado acima: a ordem importa, senão o
  // transporte remoto reintroduziria a IA que a flag acabou de desligar.
  await configurarIa(op);

  try {
    switch (op.comando) {
      case "help":
        return comandoAjuda(op);
      case "version":
        process.stdout.write("starguard 0.1.0\n");
        return SAIDA.limpo;
      case "list":
        return comandoList(op);
      case "doctor":
        return comandoDoctor(op);
      case "hook":
        return await comandoHook(op);
      case "login":
        return await comandoLogin(op);
      case "logout":
        return await comandoLogout(op);
      case "whoami":
        return await comandoWhoami(op);
      case "fix":
        return await comandoFix(op);
      case "skills":
      case "scan":
        return await comandoScan(op);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(c.red(`\n  ${msg}\n\n`));
    return SAIDA.erro;
  } finally {
    // O cursor foi escondido pelo desenho vivo; deixá-lo escondido estragaria
    // o terminal de quem interrompeu com Ctrl-C.
    mostrarCursor();
  }
}

/** Reexportado para o teste montar um workspace sem passar pelo `main`. */
export type { Workspace };
