# StarGuard para VS Code

Análise de segurança dentro do editor, com a sua conta StarGuard.

> **Requer conta da Starbridge.** A extensão não funciona sem autenticação —
> isso é característica do produto, não defeito. Se você ainda não tem conta,
> use **StarGuard: solicitar acesso** depois de instalar.

## O que ela faz

Cinco analisadores independentes. Você roda o que precisa, quando precisa —
não há sequência obrigatória.

| Analisador | O que examina | Custa IA |
|---|---|---|
| **Vulnerabilidades de código** | padrões inseguros no fonte (Opengrep/Semgrep) | não |
| **Dependências vulneráveis** | CVE conhecido nos pacotes declarados (Trivy) | não |
| **Regras de negócio** | o que scanners não pegam: regra violada, IDOR, autorização | sim |
| **Modelagem de ameaças** | ameaças e requisitos, a partir da descrição do sistema | sim |
| **Skills e prompts** | prompt injection, exfiltração, backdoor | não |

Os achados vão para o painel **Problemas**, com `source: starguard/<analisador>`
— dá para filtrar e ver só as dependências, por exemplo.

**A correção é uma lâmpada.** `Ctrl+.` num achado abre **StarGuard: corrigir com
IA**, que mostra o **diff antes de gravar**. Nada é escrito até você confirmar.

Analisador que não pode rodar **não some da lista**: fica desabilitado com o
motivo escrito no cartão. Nunca confundir "não encontrou nada" com "não
procurou".

## Comece aqui

1. Instale e abra o painel **StarGuard** na barra lateral
2. **Entrar** → o login acontece no navegador, na tela do StarGuard
3. Marque os analisadores que quiser — **quantos quiser de uma vez** — e clique
   em **Analisar**

**Você não instala scanner nenhum.** O Opengrep e o Trivy rodam no servidor da
Starbridge; a extensão manda os arquivos e recebe os achados. Rode
**StarGuard: diagnóstico** para ver o estado da conta e dos analisadores.

## Privacidade — o que sai da sua máquina

**Dependências:** só os **manifestos** (`package.json`, lockfiles) são enviados.
O Trivy resolve CVE a partir da árvore declarada e não olha o seu código —
nenhuma linha escrita por você sai da máquina.

**Código:** o código-fonte é enviado ao servidor, que roda o scanner e o
descarta. É o preço de não precisar instalar nada, e a extensão **pergunta uma
vez** antes da primeira vez.

**Regras de negócio, ameaças e correções:** usam IA. Trechos do código
analisado são enviados ao servidor da Starbridge e, dele, ao provedor de
modelo. **A extensão pede consentimento explícito antes da primeira vez.**

**O que o servidor guarda:** metadado — quem pediu, qual repositório, qual
regra, arquivo e linha, tokens e custo. **O código não é persistido**: existe em
memória durante a análise e é descartado.

**O que você controla:** a IA só é usada nos analisadores que a exigem —
**regras de negócio**, **modelagem de ameaças** e a correção assistida. Rodar
apenas código e dependências não manda nada para lugar nenhum. A extensão
**pergunta uma vez** antes da primeira chamada, e você pode revogar o
dispositivo em *Conta → Dispositivos conectados* ou desinstalar.

**A chave de IA é da Starbridge.** Não há chave para você configurar: o custo
é da conta e fica registrado nela.

## Segurança da sua conta

O login é **OAuth 2.0 com PKCE**. **A senha nunca é digitada dentro do editor**
— ela vai no navegador, na tela do StarGuard. O token fica no `SecretStorage`
(chaveiro do sistema operacional), nunca em `settings.json`.

A credencial **rotaciona a cada uso**. Se uma cópia antiga for apresentada, a
sessão inteira cai e o evento vai para a trilha de auditoria — é o que torna um
token roubado detectável.

Funciona em **Remote SSH** e **Codespaces**.

## Comandos

| Comando | O que faz |
|---|---|
| `StarGuard: analisar tudo` | roda os analisadores marcados no painel |
| `StarGuard: analisar…` | escolhe um da lista |
| `StarGuard: validar a skill aberta` | o arquivo do editor é a skill |
| `StarGuard: corrigir com IA` | lâmpada no achado; mostra o diff antes |
| `StarGuard: diagnóstico` | o que está instalado e configurado |
| `StarGuard: entrar na conta` / `sair da conta` | sessão |
| `StarGuard: solicitar acesso` | para quem ainda não tem conta |

## Configuração

| Chave | Padrão | Para quê |
|---|---|---|
| `starguard.analyzers.enabled` | `["sast","sca"]` | quais já vêm marcados |
| `starguard.locale` | `pt-BR` | idioma dos achados (pt-BR, en, es) |
| `starguard.systemDescription` | — | usada por **regras de negócio** e ameaças; dá para escrevê-la no próprio painel |
| `starguard.semgrepPath` · `starguard.trivyPath` | — | opcional: scanner local, para quem prefere não enviar arquivo nenhum |
| `starguard.server` | — | troque apenas se a sua equipe hospeda a própria instância |

Já vêm marcados os dois que **não custam IA**; os outros são um clique no cartão.

## Limitações — leia antes de confiar

**Nenhuma ferramenta encontra tudo.** Os achados vêm de scanners de padrão e de
modelos de linguagem, e **exigem revisão humana**. As correções propostas não
foram testadas contra a sua suíte, e o StarGuard não executa os seus testes.
Nada disto substitui revisão de segurança.

Se uma correção mexer num manifesto de dependência, o **lockfile não é
regerado** — rode o instalador do seu ecossistema antes de mesclar.

---

**Suporte:** <https://github.com/starbridge-org/starguard/issues>
**Licença:** proprietária — veja `LICENSE.md`
