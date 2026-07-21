"use client";

import InfoTip from "@/components/InfoTip";

export default function ThreatInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="sys-desc" className="field-label-row">
        Contexto do sistema
        <InfoTip
          title="O que descrever aqui"
          content="Cole a descrição do sistema, notas de reunião ou requisitos de compliance. Este texto vira contexto para as 4 fases: ameaças, validação de skills, scan e correção. Ex.: dados sensíveis, fluxos de login, integrações de pagamento e regras de negócio."
        />
      </label>
      <textarea
        id="sys-desc"
        className="textarea"
        style={{ minHeight: 150 }}
        placeholder="Ex.: API de telemedicina que armazena dados de saúde (LGPD). Login por e-mail/senha, prontuários por paciente, pagamento por cartão (PCI). Um médico só acessa pacientes da sua clínica…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
