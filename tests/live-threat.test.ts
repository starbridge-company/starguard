import { describe, it, expect } from "vitest";
import { generateThreatModel } from "@/lib/tasks";

// Chamada REAL ao provedor de IA — `npm run test:live`, fora do `npm test`.
//
// Existe porque a Fase 1 falhava com descrição longa e o teste com `fetch`
// mockado não pegaria: a causa é o "thinking" do modelo consumindo o mesmo
// orçamento de tokens da resposta, o que só aparece chamando de verdade.
// Ver AUDITORIA.md#BUG-13 e #PEND-27.

const DESC_LONGA = `
API de telemedicina que armazena dados de saúde (LGPD). Login por e-mail/senha,
prontuários por paciente, pagamento por cartão (PCI). Um médico só acessa
pacientes da sua clínica.

CONTEXTO DE NEGÓCIO
A plataforma atende 340 clínicas em 18 estados, com 12 mil profissionais de
saúde cadastrados e cerca de 900 mil pacientes ativos. O faturamento é por
assinatura mensal da clínica mais taxa por teleconsulta realizada. Existem
quatro perfis: paciente, profissional de saúde, administrador de clínica e
operador do backoffice. O administrador de clínica pode convidar profissionais,
mas não pode ver prontuário de paciente que não esteja em atendimento ativo com
ele. O operador de backoffice nunca pode ver conteúdo clínico — apenas
metadados de cobrança e status de agendamento.

FLUXO DE TELECONSULTA
O paciente agenda pelo aplicativo, escolhendo especialidade e horário. O sistema
reserva o slot por 10 minutos enquanto o pagamento é autorizado. Se a
autorização falhar, o slot volta para o pool. Na hora da consulta, ambos entram
numa sala de vídeo WebRTC; a gravação é opcional e exige consentimento
explícito dos dois lados, registrado em trilha de auditoria. Após a consulta, o
profissional emite prescrição digital assinada com certificado ICP-Brasil, que
o paciente recebe por e-mail e pode apresentar em qualquer farmácia.

PRONTUÁRIO E DADOS SENSÍVEIS
O prontuário guarda anamnese, exames anexados (PDF e DICOM), prescrições,
alergias e histórico de internações. Dados de saúde são dado pessoal sensível
pela LGPD e exigem base legal específica — no caso, tutela da saúde. O paciente
pode solicitar exportação completa e exclusão da conta; a exclusão preserva o
mínimo legal exigido pelo CFM por 20 anos, anonimizando o restante.

PAGAMENTOS
Cartão de crédito processado por gateway terceiro; o sistema nunca armazena PAN
nem CVV, apenas o token do gateway e os quatro últimos dígitos. Há repasse
mensal para as clínicas, calculado sobre consultas efetivamente realizadas,
descontando cancelamentos e estornos. O repasse gera um arquivo de remessa
bancária em CNAB 240.

INTEGRAÇÕES
Laboratórios enviam resultados de exame por webhook autenticado com HMAC. O
sistema consulta a base do CFM para validar o CRM do profissional no cadastro e
revalida a cada 90 dias. Há integração com o RNDS do Ministério da Saúde para
envio de registros de atendimento.

REGRAS QUE PRECISAM SER GARANTIDAS
1. Um profissional só enxerga pacientes com atendimento ativo ou histórico na
   sua própria clínica.
2. Administrador de clínica nunca vê conteúdo clínico.
3. Operador de backoffice nunca vê conteúdo clínico.
4. Gravação de consulta exige consentimento dos dois participantes.
5. Exportação de dados só pelo próprio titular, com reautenticação.
6. Prescrição só é válida com assinatura do certificado do profissional emissor.
7. Estorno só pode ser feito por operador de backoffice, nunca pela clínica.
8. Slot reservado expira em 10 minutos sem pagamento autorizado.
`.trim();

// Descrição bem maior que a original: módulos extras, cada um com suas
// próprias regras. É o cenário que estourava o orçamento — mais contexto faz o
// modelo pensar mais, e o "thinking" come o MESMO teto de tokens da resposta.
const DESC_ENORME =
  DESC_LONGA +
  "\n\n" +
  [
    "MÓDULO DE AGENDAMENTO RECORRENTE",
    "MÓDULO DE PRONTUÁRIO COMPARTILHADO ENTRE ESPECIALIDADES",
    "MÓDULO DE AUDITORIA CLÍNICA E SEGUNDA OPINIÃO",
    "MÓDULO DE ESTOQUE DE INSUMOS POR CLÍNICA",
    "MÓDULO DE CONVÊNIOS E GLOSAS",
    "MÓDULO DE TELETRIAGEM POR ENFERMAGEM",
  ]
    .map(
      (titulo, i) => `${titulo}
Este módulo atende ${(i + 3) * 47} clínicas e movimenta dados clínicos e
financeiros. Possui perfis próprios de acesso, com herança parcial dos perfis
globais, e mantém trilha de auditoria independente. As regras específicas são:
(a) somente o profissional responsável pelo caso pode encerrar o registro;
(b) qualquer alteração após o encerramento exige justificativa e fica versionada;
(c) o histórico é imutável e a exclusão é lógica, preservando o prazo do CFM;
(d) integrações externas usam credencial rotacionada a cada 30 dias;
(e) relatórios agregados nunca podem permitir reidentificação do paciente;
(f) o repasse financeiro deste módulo é calculado separadamente e conciliado
mensalmente contra o extrato bancário, com tolerância de dois centavos;
(g) toda exportação gera evento de auditoria com o motivo declarado pelo usuário.`
    )
    .join("\n\n");

describe("generateThreatModel · descrição longa (chamada REAL)", () => {
  it(
    "não trunca e devolve ameaças e requisitos dentro do orçamento",
    async () => {
      const inicio = Date.now();
      const tm = await generateThreatModel(DESC_ENORME, "pt-BR");
      const ms = Date.now() - inicio;

      console.log(
        `\n[live] ${(DESC_ENORME.length / 1000).toFixed(1)}k caracteres · ${ms} ms\n` +
          `[live] ameaças=${tm.threats.length} requisitos=${tm.requirements.length}\n` +
          `[live] summary: ${(tm.summary || "").slice(0, 160)}…\n` +
          `[live] 1ª ameaça: ${tm.threats[0]?.title}\n`
      );

      expect(tm.threats.length).toBeGreaterThan(0);
      expect(tm.requirements.length).toBeGreaterThan(0);
      // Os tetos do prompt precisam ser respeitados — é o que mantém a saída
      // com tamanho previsível qualquer que seja a entrada.
      expect(tm.threats.length).toBeLessThanOrEqual(12);
      expect(tm.requirements.length).toBeLessThanOrEqual(15);
    },
    180_000
  );
});
