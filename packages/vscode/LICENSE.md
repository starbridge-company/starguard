# Termos de Uso — StarGuard para VS Code

**Copyright © 2026 Starbridge. Todos os direitos reservados.**

> ⚠️ **Este texto é um ponto de partida, não aconselhamento jurídico.** Ele foi
> redigido para destravar a publicação na Marketplace, que exige um arquivo de
> licença. **Submeta-o à revisão jurídica da Starbridge antes de publicar** —
> especialmente as seções de dados, garantia e responsabilidade, que são as que
> importam num produto que analisa código de terceiros.

## 1. Concessão

A Starbridge concede a você uma licença pessoal, revogável, não exclusiva e
intransferível para instalar e usar esta extensão, **condicionada a uma conta
StarGuard ativa**. A extensão não funciona sem autenticação; isso é
característica do produto, não defeito.

## 2. Restrições

Você não pode: (a) redistribuir, sublicenciar, vender ou alugar a extensão;
(b) fazer engenharia reversa, descompilar ou desmontar, salvo na medida em que
a lei aplicável o permita expressamente; (c) remover ou contornar os controles
de autenticação e de cota; (d) usar a extensão para prestar serviço equivalente
a terceiros sem contrato específico com a Starbridge.

## 3. Dados — o que sai da sua máquina

Esta é a seção que você deve ler antes de instalar.

**Análise local.** Os analisadores de código (Opengrep/Semgrep) e de
dependências (Trivy) rodam **na sua máquina**, com binários seus. O código
analisado não sai daqui nessa etapa.

**Análise por IA.** Ao usar a IA pela sua conta, **trechos do código analisado
são enviados** ao servidor da Starbridge e, deste, ao provedor de modelo
contratado. A extensão pede consentimento explícito antes da primeira vez.

**O que o servidor guarda.** Metadado de uso: quem solicitou, qual repositório,
qual regra disparou, arquivo e linha, consumo de tokens e custo. **O conteúdo
do código não é persistido** — ele existe em memória durante a análise e é
descartado.

**O que você controla.** Não usar a IA pela conta (configure uma chave própria
e nada sai da máquina); revogar o dispositivo em *Conta → Dispositivos
conectados*; desinstalar a extensão.

## 4. Disponibilidade e cota

O uso da IA está sujeito a cota mensal por conta. A Starbridge pode alterar
limites, suspender contas em uso abusivo e interromper o serviço, com aviso
razoável quando praticável.

## 5. Sem garantia

**A EXTENSÃO É FORNECIDA "COMO ESTÁ", SEM GARANTIA DE QUALQUER NATUREZA.**

Especificamente, e porque isto é uma ferramenta de segurança: a Starbridge
**não garante que a análise encontre todas as vulnerabilidades** do código
examinado, nem que as correções propostas sejam completas, corretas ou seguras.
Os achados e as correções são gerados por ferramentas automatizadas e por
modelos de linguagem, e **exigem revisão humana**. Nenhum resultado desta
extensão substitui revisão de segurança, teste ou julgamento profissional.

## 6. Limitação de responsabilidade

Na máxima extensão permitida pela lei aplicável, a Starbridge não responde por
danos indiretos, incidentais, especiais ou lucros cessantes decorrentes do uso
ou da impossibilidade de uso desta extensão — incluindo vulnerabilidade não
detectada, correção incorreta aplicada, ou interrupção de serviço.

## 7. Componentes de terceiros

Esta extensão embute e depende de componentes de terceiros, cada um sob a sua
própria licença. Esses termos não os substituem.

## 8. Vigência

Esta licença vigora enquanto sua conta estiver ativa e cessa automaticamente se
você descumprir estes termos ou desinstalar a extensão.

## 9. Lei aplicável

Regem-se estes termos pelas leis da República Federativa do Brasil.

---

Contato: <https://github.com/starbridge-org>
