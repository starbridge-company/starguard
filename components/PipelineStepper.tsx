"use client";

import { Fragment } from "react";
import type { PhaseKey, StepStatus, StepAIConfig } from "@/types";
import InfoTip from "@/components/InfoTip";
import {
  IconPlan,
  IconSkills,
  IconScan,
  IconRefactor,
  IconCheck,
  IconX,
} from "@/lib/icons";

const PHASE_META: Record<
  PhaseKey,
  { Icon: typeof IconPlan; short: string; phase: string; desc: string }
> = {
  plan: {
    Icon: IconPlan,
    short: "Ameaças",
    phase: "Fase 1 · Plan",
    desc: "Modela ameaças e deriva requisitos de segurança a partir do contexto do sistema.",
  },
  skills: {
    Icon: IconSkills,
    short: "Skills",
    phase: "Fase 2 · Code",
    desc: "Valida skills/prompts contra prompt-injection, exfiltração e desvio de política.",
  },
  software: {
    Icon: IconScan,
    short: "Software",
    phase: "Fase 3 · Code",
    desc: "Roda SAST + SCA sobre o repositório e prioriza os achados por severidade.",
  },
  refactor: {
    Icon: IconRefactor,
    short: "Correção",
    phase: "Fase 4 · Refactor",
    desc: "Gera a correção automática do código e abre o Pull Request no GitHub.",
  },
};

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: "Aguardando",
  running: "Rodando",
  done: "Concluído",
  error: "Erro",
};

export interface StepMetric {
  label: string;
  value: string | number;
}

export interface PipelineStep {
  key: PhaseKey;
  status: StepStatus;
  ai?: StepAIConfig;
  engines?: string[];
  metrics?: StepMetric[];
}

export default function PipelineStepper({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="pipeline" role="list" aria-label="Progresso das 4 fases">
      {steps.map((step, i) => {
        const meta = PHASE_META[step.key];
        const prevDone = i > 0 && steps[i - 1].status === "done";
        const isSoftware = step.key === "software";

        const tip = (
          <span className="pipe-tip">
            <span className="pipe-tip-phase">{meta.phase}</span>
            <span className="pipe-tip-desc">{meta.desc}</span>
            <span className="pipe-tip-engines">
              {isSoftware ? (
                (step.engines || []).map((e) => (
                  <span key={e} className="ai-badge provider">
                    {e}
                  </span>
                ))
              ) : step.ai ? (
                <>
                  <span className="ai-badge provider">{step.ai.provider}</span>
                  <span className="ai-badge model">{step.ai.model}</span>
                </>
              ) : null}
            </span>
            {step.status === "done" && step.metrics && step.metrics.length > 0 && (
              <span className="pipe-tip-metrics">
                {step.metrics.map((m) => (
                  <span key={m.label} className="pipe-tip-metric">
                    <strong>{m.value}</strong> {m.label}
                  </span>
                ))}
              </span>
            )}
          </span>
        );

        return (
          <Fragment key={step.key}>
            {i > 0 && (
              <span
                className={`pipe-conn ${prevDone ? "is-filled" : ""}`}
                aria-hidden
              />
            )}
            <InfoTip
              side="bottom"
              size="md"
              label={`${meta.phase} — ${STATUS_LABEL[step.status]}`}
              content={tip}
            >
              <span role="listitem" className={`pipe-node is-${step.status}`}>
                <span className="pipe-dot">
                  {step.status === "done" ? (
                    <IconCheck />
                  ) : step.status === "error" ? (
                    <IconX />
                  ) : step.status === "running" ? (
                    <span className="pipe-spinner" />
                  ) : (
                    <meta.Icon />
                  )}
                </span>
                <span className="pipe-label">{meta.short}</span>
                <span className="pipe-state">{STATUS_LABEL[step.status]}</span>
              </span>
            </InfoTip>
          </Fragment>
        );
      })}
    </div>
  );
}
