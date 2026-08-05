"use client";

import { Fragment } from "react";
import type { PhaseKey, StepStatus, StepAIConfig } from "@/types";
import InfoTip from "@/components/InfoTip";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  IconPlan,
  IconSkills,
  IconScan,
  IconRefactor,
  IconCheck,
  IconX,
} from "@/lib/icons";

// Rótulos por chave de tradução — o stepper aparece na tela de resultados, que
// é fluxo principal, e era a última peça dela ainda em português fixo.
// Ver AUDITORIA.md#PEND-23.
const PHASE_META: Record<
  PhaseKey,
  { Icon: typeof IconPlan; shortKey: MessageKey; phaseKey: MessageKey; descKey: MessageKey }
> = {
  plan: {
    Icon: IconPlan,
    shortKey: "pipe.plan.short",
    phaseKey: "pipe.plan.phase",
    descKey: "pipe.plan.desc",
  },
  skills: {
    Icon: IconSkills,
    shortKey: "pipe.skills.short",
    phaseKey: "pipe.skills.phase",
    descKey: "pipe.skills.desc",
  },
  software: {
    Icon: IconScan,
    shortKey: "pipe.software.short",
    phaseKey: "pipe.software.phase",
    descKey: "pipe.software.desc",
  },
  refactor: {
    Icon: IconRefactor,
    shortKey: "pipe.refactor.short",
    phaseKey: "pipe.refactor.phase",
    // A fase não gera mais nada sozinha: correção custa IA e agora só sai por
    // clique explícito, na aba Correções. Ver AUDITORIA.md#BUG-16.
    descKey: "pipe.refactor.desc",
  },
};

const STATUS_KEY: Record<StepStatus, MessageKey> = {
  pending: "pipe.status.pending",
  running: "pipe.status.running",
  done: "pipe.status.done",
  error: "pipe.status.error",
  skipped: "pipe.status.skipped",
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
  const t = useT();
  return (
    <div className="pipeline" role="list" aria-label={t("pipe.ariaLabel")}>
      {steps.map((step, i) => {
        const meta = PHASE_META[step.key];
        const prevDone = i > 0 && steps[i - 1].status === "done";
        const isSoftware = step.key === "software";

        const tip = (
          <span className="pipe-tip">
            <span className="pipe-tip-phase">{t(meta.phaseKey)}</span>
            <span className="pipe-tip-desc">{t(meta.descKey)}</span>
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
              label={`${t(meta.phaseKey)} — ${t(STATUS_KEY[step.status])}`}
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
                <span className="pipe-label">{t(meta.shortKey)}</span>
                <span className="pipe-state">{t(STATUS_KEY[step.status])}</span>
              </span>
            </InfoTip>
          </Fragment>
        );
      })}
    </div>
  );
}
