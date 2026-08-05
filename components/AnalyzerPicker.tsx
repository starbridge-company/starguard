"use client";

// ============================================================
// Seletor de analisadores — Tela 1.
//
// Substitui o `mini-pipeline` de quatro caixas fixas, que só ilustrava um
// fluxo obrigatório. Aqui cada analisador é uma escolha, e a escolha é o
// produto: quem quer validar uma skill não deveria ter de esperar a modelagem
// de ameaças por causa de uma ordem que alguém desenhou uma vez.
//
// A disponibilidade vem de `/api/analyzers`, que é a MESMA função que o job
// usa para montar o plano. Se divergissem, a tela ofereceria algo que o job
// depois recusa.
//
// Indisponível aparece DESABILITADO E COM MOTIVO, nunca ausente — é o mesmo
// princípio do UX-15: quem lê a tela precisa distinguir "não encontrou" de
// "não procurou", e agora também de "não dá para procurar, e eis o porquê".
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/client";
import { useT, type MessageKey } from "@/lib/i18n";
import InfoTip from "@/components/InfoTip";
import {
  IconPlan,
  IconCode,
  IconPackage,
  IconShield,
  IconSkills,
  IconCheck,
  IconRefactor,
  IconRepo,
} from "@/lib/icons";
import type { AnalyzerId } from "@/types";

export interface AnalyzerInfo {
  id: AnalyzerId;
  nameKey: string;
  descKey: string;
  available: boolean;
  reasonKey?: string;
  detail?: string;
  needs: { workspace: boolean; ai: boolean; input?: string[] };
  fixable: boolean;
}

const ICON: Record<AnalyzerId, typeof IconPlan> = {
  threat: IconPlan,
  sast: IconCode,
  sca: IconPackage,
  business: IconShield,
  skills: IconSkills,
};

export default function AnalyzerPicker({
  value,
  onChange,
  repoUrl,
  hasDescription,
  hasSkills,
}: {
  value: AnalyzerId[];
  onChange: (v: AnalyzerId[]) => void;
  repoUrl?: string;
  hasDescription: boolean;
  hasSkills: boolean;
}) {
  const t = useT();
  const [analyzers, setAnalyzers] = useState<AnalyzerInfo[] | null>(null);

  // Reconsulta quando muda o que a disponibilidade depende. A URL entra na
  // chave para o efeito não disparar a cada tecla digitada em outro campo.
  const chave = `${repoUrl || ""}|${hasDescription}|${hasSkills}`;

  useEffect(() => {
    let vivo = true;
    const params = new URLSearchParams();
    if (repoUrl?.trim()) params.set("repoUrl", repoUrl.trim());
    if (hasDescription) params.set("description", "1");
    if (hasSkills) params.set("skills", "1");

    void apiGet<{ analyzers: AnalyzerInfo[] }>(`/api/analyzers?${params}`)
      .then((r) => {
        if (vivo) setAnalyzers(r.analyzers);
      })
      .catch(() => {
        // Falha ao consultar não pode travar a Tela 1: sem a lista, o
        // formulário segue e o servidor decide. O seletor some, mas o botão
        // de enviar continua funcionando com "todos".
        if (vivo) setAnalyzers([]);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const disponiveis = useMemo(
    () => (analyzers ?? []).filter((a) => a.available).map((a) => a.id),
    [analyzers]
  );

  // Um analisador que era selecionável e deixou de ser (a pessoa apagou a URL
  // do repositório) não pode continuar marcado por trás — a rota recusaria e o
  // erro apareceria longe da causa.
  useEffect(() => {
    if (!analyzers) return;
    const podem = new Set(disponiveis);
    const limpo = value.filter((id) => podem.has(id));
    if (limpo.length !== value.length) onChange(limpo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disponiveis.join(",")]);

  if (analyzers === null) {
    return (
      <div className="field">
        <label>{t("select.title")}</label>
        <p className="field-hint">{t("select.loading")}</p>
      </div>
    );
  }
  if (!analyzers.length) return null;

  const alterna = (id: AnalyzerId) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="field">
      <div className="picker-head">
        <div>
          <label>{t("select.title")}</label>
          <p className="field-hint">{t("select.hint")}</p>
        </div>
        <div className="picker-actions">
          <button
            type="button"
            className="button ghost small"
            onClick={() => onChange(disponiveis)}
            disabled={value.length === disponiveis.length}
          >
            {t("select.all")}
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => onChange([])}
            disabled={!value.length}
          >
            {t("select.none")}
          </button>
        </div>
      </div>

      <div className="analyzer-grid" role="group" aria-label={t("select.title")}>
        {analyzers.map((a) => {
          const Icon = ICON[a.id];
          const marcado = value.includes(a.id);
          const motivo = a.reasonKey
            ? t(a.reasonKey as MessageKey, { bin: a.detail ?? "" })
            : "";

          return (
            <label
              key={a.id}
              className={`analyzer-card ${marcado ? "is-on" : ""} ${
                a.available ? "" : "is-off"
              }`}
            >
              <input
                type="checkbox"
                checked={marcado}
                disabled={!a.available}
                onChange={() => alterna(a.id)}
              />
              <span className="analyzer-icon">
                <Icon />
              </span>
              <span className="analyzer-body">
                <span className="analyzer-name">
                  {t(a.nameKey as MessageKey)}
                  {a.fixable && (
                    <InfoTip content={t("select.fixes")}>
                      <span className="analyzer-badge" aria-label={t("select.fixes")}>
                        <IconRefactor />
                      </span>
                    </InfoTip>
                  )}
                  {a.needs.workspace && (
                    <InfoTip content={t("select.needsRepo")}>
                      <span className="analyzer-badge" aria-label={t("select.needsRepo")}>
                        <IconRepo />
                      </span>
                    </InfoTip>
                  )}
                </span>
                <span className="analyzer-desc">{t(a.descKey as MessageKey)}</span>
                {/* O motivo é a parte que não pode faltar: um item apagado sem
                    explicação faz a pessoa achar que a ferramenta está quebrada. */}
                {!a.available && <span className="analyzer-reason">{motivo}</span>}
                {a.available && a.detail && (
                  <span className="analyzer-detail">{a.detail}</span>
                )}
              </span>
              {marcado && (
                <span className="analyzer-check" aria-hidden="true">
                  <IconCheck />
                </span>
              )}
            </label>
          );
        })}
      </div>

      <p className={`field-hint ${value.length ? "" : "is-warn"}`}>
        {value.length
          ? t("select.chosen", { n: value.length, total: disponiveis.length })
          : t("select.empty")}
      </p>
    </div>
  );
}
