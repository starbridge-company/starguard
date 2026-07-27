"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FixResult, FixTarget } from "@/types";
import SeverityBadge from "@/components/SeverityBadge";
import InfoTip from "@/components/InfoTip";
import Modal from "@/components/Modal";
import CodeDiff from "@/components/CodeDiff";
import TokenPrompt, { type TokenChoice } from "@/components/TokenPrompt";
import { apiPost, ApiError, isAbortError } from "@/lib/client";
import {
  FIX_CHUNK_SIZE,
  clampFix,
  clampPrBody,
  clampPrTitle,
} from "@/lib/validation";
import { useRepoVisibility } from "@/lib/useRepoVisibility";
import { useApiError, useT, type MessageKey } from "@/lib/i18n";
import {
  IconX,
  IconCheck,
  IconPullRequest,
  IconExternal,
  IconCheckCircle,
  IconChevronDown,
  IconRefactor,
} from "@/lib/icons";

type ItemStatus = "queued" | "running" | "done" | "error" | "cancelled";
interface ItemState {
  status: ItemStatus;
  fix?: FixResult;
  error?: string;
  /** Quantos achados foram corrigidos junto neste mesmo arquivo. */
  groupSize?: number;
}

interface BatchPR {
  number: number;
  url: string;
  branch: string;
  committed: number;
}

const CONCURRENCY = 3;

const STATUS_KEY: Record<ItemStatus, MessageKey> = {
  queued: "batch.statusQueued",
  running: "batch.statusRunning",
  done: "batch.statusDone",
  error: "batch.statusError",
  cancelled: "batch.statusCancelled",
};

const EXT_LANG: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  php: "php",
  cs: "csharp",
};

function guessLang(file: string): string | undefined {
  const ext = file.split(".").pop()?.toLowerCase();
  return ext ? EXT_LANG[ext] : undefined;
}

function normPath(f: string): string {
  return f.replace(/\\/g, "/").toLowerCase();
}

/** Divide em blocos de no máximo `size`. Nada sobra de fora. */
function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export default function BatchFixModal({
  vulns,
  repoUrl,
  analysisId,
  findingIdByLocal,
  onPrOpened,
  onClose,
}: {
  vulns: FixTarget[];
  repoUrl?: string;
  analysisId?: string;
  /** localId ("V-3") -> id do achado persistido, para guardar a correção. */
  findingIdByLocal?: Record<string, string>;
  /** Chamado com os localIds cujas correções entraram no PR. */
  onPrOpened?: (localIds: string[]) => void;
  onClose: () => void;
}) {
  // Nada começa sozinho: gerar N correções custa dinheiro e tempo, então o
  // usuário confirma antes. Ver AUDITORIA.md#UX-05.
  const t = useT();
  const apiError = useApiError();
  const [phase, setPhase] = useState<"confirm" | "working">("confirm");
  const [items, setItems] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(vulns.map((v) => [v.id, { status: "queued" as ItemStatus }]))
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [prState, setPrState] = useState<"idle" | "loading" | "done">("idle");
  const [pr, setPr] = useState<BatchPR | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  // Falta de token tem tratamento próprio: as correções já estão geradas e
  // guardadas, então basta a credencial e repetir — sem gastar IA de novo.
  const [needToken, setNeedToken] = useState<string | null>(null);
  // Repositório privado exige token do usuário. Saber disso ANTES do clique
  // evita a tentativa que falha só para descobrir.
  const { isPrivate } = useRepoVisibility(repoUrl);
  const pedirToken = needToken !== null || isPrivate === true;
  const abortRef = useRef<AbortController | null>(null);
  // Distingue "o usuário mandou parar" de "o modal fechou".
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);

  // Achados do MESMO arquivo viram UMA correção. Gerar uma por achado fazia
  // cada uma partir do arquivo original, e o PR (que deduplica por caminho)
  // guardava só a última — as demais sumiam em silêncio, com a tela dizendo
  // que tinham sido corrigidas. Ver AUDITORIA.md#BUG-06.
  const groups = useMemo(() => {
    const m = new Map<string, FixTarget[]>();
    for (const v of vulns) {
      const k = normPath(v.file);
      const list = m.get(k);
      if (list) list.push(v);
      else m.set(k, [v]);
    }
    return [...m.values()];
  }, [vulns]);

  // Gera as correções em paralelo (pool de workers), UMA por arquivo.
  useEffect(() => {
    if (phase !== "working") return;
    const controller = new AbortController();
    abortRef.current = controller;
    mountedRef.current = true;
    const queue = [...groups];

    // Depois de desmontado, o trabalho continua no servidor mas a tela não
    // existe mais — atualizar estado aqui seria inútil.
    const setItem = (id: string, patch: Partial<ItemState>) => {
      if (!mountedRef.current) return;
      setItems((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    };

    async function worker() {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift()!;
        if (!group.length) continue;
        for (const v of group) setItem(v.id, { status: "running" });

        try {
          // Um arquivo pode ter mais achados do que cabe numa passada — o
          // scan real deste repositório concentrou 576 em poucos arquivos.
          // Fatiamos e ENCADEAMOS: cada fatia parte do resultado da anterior
          // (`baseCode`), então nada é descartado e nada é reescrito por cima.
          const chunks = chunk(group, FIX_CHUNK_SIZE);
          let fix: FixResult | null = null;
          // O que a fatia anterior já corrigiu — entra como base da próxima.
          let base: string | undefined;
          // O engine de agente pode tocar em VÁRIOS arquivos numa fatia. O
          // resultado final é o da última, que só conhece o arquivo principal
          // — sem acumular aqui, o que as fatias anteriores mudaram em outros
          // arquivos sumiria do PR. Ver AUDITORIA.md#BUG-07.
          type Alterado = NonNullable<FixResult["changedFiles"]>[number];
          const extras = new Map<string, Alterado>();

          for (const bloco of chunks) {
            if (controller.signal.aborted) break;
            const [primary, ...rest] = bloco;
            if (!primary) continue;

            fix = await apiPost<FixResult>(
              "/api/step4-fix",
              {
                // Só a ÚLTIMA fatia grava a correção do achado: guardar as
                // intermediárias deixaria o cache do FEAT-02 com um arquivo
                // corrigido pela metade.
                findingId:
                  bloco === chunks[chunks.length - 1]
                    ? findingIdByLocal?.[primary.id]
                    : undefined,
                analysisId,
                vulnerabilityId: primary.id,
                file: primary.file,
                // Cortado antes de enviar — ver `clampFix` em lib/validation.
                originalCode: clampFix(
                  "originalCode",
                  primary.codeSnippet || primary.description || primary.title
                ),
                description: clampFix(
                  "description",
                  primary.description || primary.title
                ),
                suggestion: clampFix("suggestion", primary.suggestion),
                language: guessLang(primary.file),
                line: primary.line,
                endLine: primary.endLine,
                cwe: primary.cwe,
                owasp: primary.owasp,
                ruleId: primary.ruleId,
                repoUrl,
                baseCode: base,
                alsoFix: rest.map((v) => ({
                  vulnerabilityId: v.id,
                  description: clampFix("description", v.description || v.title),
                  suggestion: clampFix("suggestion", v.suggestion),
                  line: v.line,
                  endLine: v.endLine,
                  cwe: v.cwe,
                  owasp: v.owasp,
                  ruleId: v.ruleId,
                })),
              },
              { signal: controller.signal }
            );
            base = fix.fixedCode;
            // Última gravação por caminho vence — dentro de uma mesma fatia o
            // conteúdo já vem consolidado pelo engine.
            for (const c of fix.changedFiles || []) {
              extras.set(normPath(c.file), c);
            }
          }

          if (!fix) continue;
          // O arquivo principal fica com o conteúdo da ÚLTIMA fatia (o que
          // acumulou todas as correções); os demais, com o que cada fatia
          // deixou.
          extras.set(normPath(fix.file), {
            file: fix.file,
            originalCode: fix.originalCode,
            fixedCode: fix.fixedCode,
          });
          const resultado: FixResult =
            extras.size > 1 ? { ...fix, changedFiles: [...extras.values()] } : fix;
          for (const v of group) {
            setItem(v.id, {
              status: "done",
              fix: resultado,
              groupSize: group.length,
            });
          }
        } catch (err) {
          if (isAbortError(err)) {
            for (const v of group) setItem(v.id, { status: "cancelled" });
            return;
          }
          const error =
            apiError(err, "batch.genFailed");
          for (const v of group) setItem(v.id, { status: "error", error });
        }
      }
      // O que ficou na fila quando o cancelamento chegou.
      if (controller.signal.aborted) {
        for (const g of queue) {
          for (const v of g) setItem(v.id, { status: "cancelled" });
        }
      }
    }

    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, groups.length) }, worker)
    );

    return () => {
      mountedRef.current = false;
      // FECHAR o modal não é o mesmo que CANCELAR.
      //
      // Abortar na desmontagem jogava fora exatamente as `CONCURRENCY` (3)
      // chamadas em voo — já pagas — e elas eram as únicas que precisavam
      // rodar a IA de novo ao reabrir. Deixando-as terminar, o servidor grava
      // a correção e na próxima abertura ela volta do cache, de graça.
      //
      // Cancelar de propósito (o botão) continua abortando: aí a intenção é
      // parar de gastar.
      if (cancelRef.current) controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const states = vulns.map((v) => items[v.id]);
  const doneCount = states.filter((s) => s?.status === "done").length;
  const errorCount = states.filter((s) => s?.status === "error").length;
  const cancelledCount = states.filter((s) => s?.status === "cancelled").length;
  const pending = states.filter(
    (s) => s?.status === "queued" || s?.status === "running"
  ).length;
  const generating = phase === "working" && pending > 0;
  const total = vulns.length;

  // Fechar a aba durante a geração perde o que está em voo — e cada item em
  // voo é uma chamada de IA já paga, que o servidor vai terminar e jogar fora.
  // É o único caso que sobrou do AUDITORIA.md#UX-20: o FEAT-02 guarda tudo o
  // que JÁ ficou pronto, e o UX-03 cuida do texto digitado nos modais.
  useEffect(() => {
    if (!generating) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Navegador moderno ignora o texto e mostra o diálogo padrão; o
      // `returnValue` continua sendo o que dispara o diálogo.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [generating]);

  const settled = doneCount + errorCount + cancelledCount;
  const pct = total ? Math.round((settled / total) * 100) : 0;

  // Um arquivo = uma entrada no PR. Correções sem alteração ficam de fora.
  const prFiles = useMemo(() => {
    const seen = new Set<string>();
    const out: { file: string; fixedCode: string; explanation: string }[] = [];
    for (const group of groups) {
      const s = items[group[0]!.id];
      if (s?.status !== "done" || !s.fix || s.fix.noChange) continue;
      // O engine de agente pode ter tocado em mais arquivos que o principal.
      const changed = s.fix.changedFiles?.length
        ? s.fix.changedFiles
        : [{ file: s.fix.file, fixedCode: s.fix.fixedCode }];
      for (const c of changed) {
        const key = normPath(c.file);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          file: c.file,
          fixedCode: c.fixedCode,
          explanation: s.fix.explanation,
        });
      }
    }
    return out;
  }, [groups, items]);

  const noChangeCount = groups.filter((g) => items[g[0]!.id]?.fix?.noChange).length;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openBatchPR = async (tokenChoice?: TokenChoice) => {
    if (!repoUrl || !prFiles.length) return;

    setPrState("loading");
    setPrError(null);
    setNeedToken(null);
    try {
      // O corpo é texto NOSSO: uma linha por arquivo com a explicação da IA.
      // Ele cresce com o tamanho do lote e passava do limite — derrubando o PR
      // DEPOIS de toda a geração já estar paga. Cortar na origem é o certo:
      // recusar a própria saída no último passo não protege nada.
      const body = clampPrBody(
        [
          t("pr.batchIntro", { findings: total, files: prFiles.length }),
          "",
          ...prFiles.map((f) => `- \`${f.file}\`: ${f.explanation}`),
          "",
          t("pr.reviewBeforeMerge"),
        ].join("\n")
      );

      const result = await apiPost<BatchPR>("/api/github/pr-batch", {
        repoUrl,
        files: prFiles.map((f) => ({ file: f.file, fixedCode: f.fixedCode })),
        title: clampPrTitle(t("pr.batchTitle", { n: total })),
        body,
        analysisId,
        ...tokenChoice,
      });
      setPr(result);
      setPrState("done");
      onPrOpened?.(
        groups
          .filter((g) => {
            const s = items[g[0]!.id];
            return s?.status === "done" && s.fix && !s.fix.noChange;
          })
          .flatMap((g) => g.map((v) => v.id))
      );
    } catch (err) {
      // Falta de token não é erro a exibir: a tela pede a credencial.
      if (err instanceof ApiError && err.key === "err.githubTokenRequired") {
        setNeedToken(err.message);
      } else {
        setPrError(
          apiError(err, "batch.prFailed")
        );
      }
      // `finally`, e não uma linha por caminho: um `return` dentro do catch já
      // pulou este reset uma vez e travou os dois botões girando para sempre.
      // Estado de carregamento precisa morrer em TODA saída.
      setPrState("idle");
    }
  };

  // ---------- Tela de confirmação ----------
  if (phase === "confirm") {
    return (
      <Modal title={t("batch.title")} onClose={onClose}>
        <div className="vuln-suggestion">
          <span className="label">{t("batch.whatHappens")}</span>
          {t("batch.plan", {
            findings: total,
            files: groups.length,
            calls: groups.length,
          })}
          {groups.length !== total && <> {t("batch.grouped")}</>}
          <div className="field-hint" style={{ marginTop: 8 }}>
            {t("batch.costHint")}
          </div>
        </div>

        <div className="batch-list">
          {groups.map((g) => (
            <div className="batch-item" key={g[0]!.id}>
              <div className="batch-item-head">
                <span className="muted mono batch-item-loc">{g[0]!.file}</span>
                <span className="badge">{t("batch.nFindings", { n: g.length })}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="batch-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => setPhase("working")}
          >
            <IconRefactor /> {t("batch.start", { n: groups.length })}
          </button>
        </div>
      </Modal>
    );
  }

  // ---------- Geração + PR ----------
  return (
    <Modal
      title={t("batch.title")}
      onClose={onClose}
      confirmClose={() => (generating ? t("batch.confirmClose") : null)}
      titleExtra={
        <InfoTip
          title={t("help.batchModal")}
          content={t("help.batchModalText")}
        />
      }
    >
      <p className="muted">
        {generating
          ? t("batch.generating", { done: doneCount, total })
          : t("batch.summary", { done: doneCount, total })}
        {groups.length !== total && (
          <>
            {" · "}
            {t("batch.nFiles", { n: groups.length })}
          </>
        )}
      </p>

      <div className="progress-track" aria-label={t("batch.generating", { done: doneCount, total })}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {generating && (
        <div className="vuln-actions">
          <button
            type="button"
            className="button ghost small"
            onClick={() => {
              cancelRef.current = true;
              abortRef.current?.abort();
            }}
          >
            <IconX /> {t("batch.cancel")}
          </button>
          <span className="field-hint">{t("batch.cancelHint")}</span>
        </div>
      )}

      <div className="batch-list">
        {vulns.map((v) => {
          const s = items[v.id];
          const isOpen = expanded.has(v.id);
          return (
            <div key={v.id} className={`batch-item is-${s?.status}`}>
              <div className="batch-item-head">
                <span className={`batch-chip ${s?.status}`}>
                  {s?.status === "done" ? (
                    <IconCheck />
                  ) : s?.status === "error" || s?.status === "cancelled" ? (
                    <IconX />
                  ) : s?.status === "running" ? (
                    <span className="button-spinner" />
                  ) : (
                    <span className="dot" />
                  )}
                  {t(STATUS_KEY[s?.status ?? "queued"])}
                </span>
                <SeverityBadge severity={v.severity} />
                <span className="batch-item-title">{v.title}</span>
                <span className="muted mono batch-item-loc">
                  {v.file}:{v.line}
                </span>
                {s?.status === "done" && (
                  <button
                    type="button"
                    className={`batch-toggle ${isOpen ? "is-open" : ""}`}
                    onClick={() => toggle(v.id)}
                  >
                    {t("diff.viewDiff")} <IconChevronDown />
                  </button>
                )}
              </div>

              {v.description && <p className="batch-item-desc">{v.description}</p>}

              {s?.status === "done" && (s.groupSize ?? 1) > 1 && (
                <p className="batch-item-desc muted">
                  {t("batch.groupedWith", { n: (s.groupSize ?? 1) - 1 })}
                </p>
              )}

              {s?.status === "done" && s.fix?.noChange && (
                <div className="batch-item-error">
                  {t("batch.noChangeItem")}
                </div>
              )}

              {s?.status === "error" && (
                <div className="batch-item-error">{s.error}</div>
              )}

              {s?.status === "done" && isOpen && s.fix && (
                <div className="batch-diff">
                  <CodeDiff
                    original={s.fix.originalCode}
                    fixed={s.fix.fixedCode}
                    maxHeight={280}
                  />
                  <div className="vuln-suggestion">
                    <span className="label">{t("fix.whatChanged")}</span>
                    {s.fix.explanation}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pr ? (
        <div className="alert success">
          <IconCheckCircle />
          <span>
            {t("batch.prOpened", { number: pr.number, files: pr.committed })}{" "}
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="link"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              {t("fix.viewOnGithub")} <IconExternal />
            </a>
          </span>
        </div>
      ) : (
        <div className="batch-footer">
          {prError && <div className="alert error">{prError}</div>}
          {/* As correções já estão geradas e guardadas; falta a credencial.
              Pedir aqui evita perder o lote inteiro por um 502 genérico. */}
          {pedirToken && (
            <TokenPrompt
              busy={prState === "loading"}
              onRetry={(escolha) => void openBatchPR(escolha)}
            />
          )}
          {noChangeCount > 0 && !generating && (
            <div className="alert info">
              {t("batch.noChangeCount", { n: noChangeCount })}
            </div>
          )}
          {/* Com o seletor de token na tela, ele é quem abre o PR. Mostrar
              também o botão principal deixava DOIS botões fazendo a mesma
              coisa, um deles sem a credencial escolhida. */}
          {repoUrl && !pedirToken ? (
            <button
              type="button"
              className="button primary"
              onClick={() => void openBatchPR()}
              disabled={generating || prFiles.length === 0 || prState === "loading"}
              aria-busy={prState === "loading"}
            >
              {prState === "loading" ? (
                <span className="button-spinner" />
              ) : (
                <IconPullRequest />
              )}
              {generating
                ? t("batch.waiting")
                : t("batch.openPr", { n: prFiles.length })}
            </button>
          ) : !repoUrl ? (
            // Só quando falta o REPOSITÓRIO. Com o seletor de token na tela o
            // botão some, e mostrar "informe a URL" ali seria mentira.
            <span className="field-hint">{t("fix.needRepo")}</span>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
