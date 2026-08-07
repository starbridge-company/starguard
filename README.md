# StarGuard — Copilot de Segurança (MVP)

Plataforma de segurança assistida por IA para desenvolvimento seguro de software.
Cobre o ciclo de **DevSecOps em 4 fases** numa plataforma única, é **headless**
(troca de ferramenta/modelo por etapa via env) e reaproveita a identidade visual
do painel **Starbridge** (claro + escuro, sidebar sempre escura).

> **Escopo do MVP:** um exemplo de cada uma das 4 fases rodando ponta a ponta,
> priorizando **visual/formato**. Roda **out-of-the-box em `DEMO_MODE`** com
> fixtures — sem clonar repositório nem exigir Semgrep/Trivy/keys de IA.

## As 4 fases

| # | Fase | Engine | Saída |
|---|------|--------|-------|
| 1 | **Plan** · Modelagem de ameaças | Claude (headless) | ameaças + requisitos técnicos → viram contexto |
| 2 | **Code** · Validação de Skills | Claude + heurísticas | skills validadas/reprovadas (anti prompt-injection/exfiltração) |
| 3 | **Code** · Scan do software | Opengrep/Semgrep (SAST) + Trivy (SCA) | vulnerabilidades + dependências vulneráveis |
| 4 | **Refactor** · Correção automática | Claude (headless) | código corrigido + PR no GitHub |

## Stack

- **Next.js (App Router) + TypeScript + Tailwind v4** — as API Routes são o backend.
- **Node.js self-hosted** (não serverless — Semgrep/Trivy rodam via `child_process`).
- **jose** (JWT RS256) · **argon2** (Argon2id) · **zod** (validação) · **octokit** (GitHub).
- IA via `fetch` genérico (Anthropic/OpenAI/Google) — trocável por etapa.

## Quickstart

```bash
npm install
npm run dev        # gera chaves JWT automaticamente (predev) e sobe em :3000
```

Acesse **http://localhost:3000** → login → onboarding → painel → relatório.

> O `:3000` acima é do `next dev`. **O deploy é na porta 3003** — a imagem de
> produção traz `PORT=3003`, e é para ela que o proxy reverso aponta:
>
> ```bash
> docker build -t starguard .
> docker run -p 3003:3003 --env-file .env.local starguard
> ```
>
> `PORT` continua mandando: quem hospeda pode injetar a sua e ela vence o padrão.
>
> **Produção:** `https://starguard.starbridge.com.br` (servidor dedicado, com
> Coolify). É o endereço que a extensão do VS Code e o `starguard` do terminal
> usam por padrão — `starguard.server` e `STARGUARD_SERVER` cobrem quem
> auto-hospeda. Variáveis, rede e o que fazer quando não sobe: **[DEPLOY.md](DEPLOY.md)**.

**Credenciais demo** (já preenchidas na tela de login):

```
admin@starguard.local
StarGuard!2026
```

O `npm run dev` roda `scripts/gen-keys.mjs`, que grava `JWT_PRIVATE_KEY`,
`JWT_PUBLIC_KEY` e `COOKIE_SECRET` em `.env.local` (nunca versionado).
Para regenerar: `npm run gen:keys`.

> Em dev local (http) o `.env.local` usa `SESSION_SECURE=false` para os cookies
> funcionarem sem HTTPS. **Em produção use `SESSION_SECURE=true` + HTTPS.**

## Design headless (por etapa)

Cada engine **e cada modelo de IA** é configurável por env, sem tocar no código
(`lib/config.ts` centraliza o mapa `step → { provider, model, engine }`; as rotas
passam por `lib/ai.ts`, nunca referenciam um provider diretamente):

```env
AI_PROVIDER=anthropic      # default
AI_MODEL=claude-sonnet-5

STEP1_MODEL=claude-sonnet-5   # override por etapa
STEP2_PROVIDER=openai
STEP4_MODEL=claude-opus-4-8

SAST_ENGINE=opengrep       # opengrep | semgrep | none
SCA_ENGINE=trivy           # trivy | none
DAST_ENGINE=none           # slot futuro (ZAP)

DEMO_MODE=true             # false = integrações reais
```

## De demo para real

Defina `DEMO_MODE=false` e configure o que cada fase usa:

- **Fase 1/2/4 (IA):** `ANTHROPIC_API_KEY` (ou `OPENAI_API_KEY`/`GOOGLE_API_KEY`).
- **Fase 3 (scan):** instale **git**, **Opengrep/Semgrep** e **Trivy** no host.
  Sem o binário, a fase retorna erro explicativo (não quebra o app).
- **PR (Fase 4):** `GITHUB_TOKEN` (ou token por requisição).

Quando um binário/lib não existe, a etapa degrada com mensagem clara em vez de falhar.

## Segurança do próprio produto (não-negociável)

- **Auth:** Argon2id (params por env) + **JWT RS256** (access 15m + refresh
  rotativo com **blocklist** no logout). Cookies `httpOnly`+`Secure`+`SameSite=Strict`.
  Mensagens de login **genéricas** + rate limit por conta+IP.
- **Middleware default-deny** em todas as rotas (authn/authz) + rate limit global por IP.
- **Zod** em 100% das entradas. **Anti command injection**: `execFile` com array de
  argumentos (nunca shell string). **Anti-SSRF**: allowlist `github.com`, bloqueio de IPs internos.
- **Security headers** (CSP, HSTS, X-Frame-Options, nosniff, Referrer/Permissions-Policy).
- **Sandbox de scan:** clone descartável em tmp, cleanup garantido, **só escaneia** (nunca executa).
  Token do GitHub vive **só em memória** durante o job.
- **Auditoria** de eventos (login, PR) sem dados sensíveis; sem stack trace pro cliente.

> **Dogfooding:** rode as Fases 2 e 3 do próprio StarGuard sobre este repositório em CI.

## O que cada analisador faz

Cinco analisadores independentes. Nenhum é pré-requisito de outro: dá para
marcar um, três ou todos. As mesmas quatro perguntas para os cinco, para que
dê para compará-los lado a lado — e a última é a que mais separa um do outro.

> Este texto é o mesmo que aparece no pop-up do painel e no tooltip da
> extensão: ele vive em `packages/core/src/i18n/messages.ts`, nos três idiomas.
> Corrigir uma frase aqui é corrigir nos três produtos.

### 🗺️ Modelagem de ameaças · `threat`

- **Para que serve:** você descreve o sistema em texto e ela responde o que pode dar errado ali.
- **Quando usar:** antes de existir código, ou quando você precisa saber o que exigir de quem vai construir.
- **O que entrega:** uma lista de ameaças e uma lista de requisitos de segurança — a régua do projeto.
- **O que aponta como correção:** nada no código. Ela não corrige: ela diz o que o sistema deveria garantir.

### 🔎 Vulnerabilidades de código · `sast`

- **Para que serve:** lê o código à procura de trechos escritos de um jeito reconhecidamente inseguro.
- **Quando usar:** sempre que houver código. É rápido e não usa IA.
- **O que entrega:** trechos perigosos com arquivo e linha — senha escrita no meio do código, consulta ao banco montada com texto de fora, comando do sistema montado do mesmo jeito.
- **O que aponta como correção:** o trecho a reescrever, com a sugestão pronta para aplicar.

### 📦 Dependências vulneráveis · `sca`

- **Para que serve:** confere as bibliotecas de terceiros que o projeto usa contra falhas já descobertas e publicadas.
- **Quando usar:** sempre que houver lista de dependências. É rápido, não usa IA e costuma ser o que rende resultado no primeiro dia.
- **O que entrega:** quais pacotes têm problema conhecido, quão grave é cada um e em que versão já foi resolvido.
- **O que aponta como correção:** a versão para onde subir. Aqui a correção é trocar um número — o seu código não muda.

### 🛡️ Regras de negócio · `business`

- **Para que serve:** lê o código e responde o que já está errado no que ele faz, não em como ele foi escrito.
- **Quando usar:** quando o código existe e você quer o que o scanner não enxerga. Fica melhor com a descrição do sistema preenchida.
- **O que entrega:** um cliente conseguindo ver o pedido de outro, tela de administrador aberta a qualquer pessoa logada, preço aceito do navegador em vez de conferido no banco.
- **O que aponta como correção:** o trecho a mudar, com a sugestão pronta — e dá para aplicar pelo próprio StarGuard.

### 🧩 Skills e prompts · `skills`

- **Para que serve:** lê as instruções escritas para agentes de IA à procura de armadilha embutida no texto.
- **Quando usar:** quando o projeto tem skill, prompt ou agente — principalmente os que vieram de fora.
- **O que entrega:** instrução que desvia o agente do que foi pedido, que manda dado para fora ou que deixa uma porta aberta.
- **O que aponta como correção:** o trecho da instrução a remover ou reescrever.

### Modelagem de ameaças × Regras de negócio

As duas são pedidas juntas com frequência, e a diferença cabe numa linha:

> **A Modelagem escreve a régua. As Regras de negócio medem o código com ela.**

Uma olha para o **futuro** (o que pode dar errado) e produz exigências; a outra
olha para o **presente** (o que está errado) e produz consertos. A ligação é de
mão única e **opcional**: `business` declara `uses: ["threat", "sast", "sca"]`
como **enriquecimento**, nunca como pré-requisito — pedir só regras de negócio
não arrasta ninguém para dentro da execução. Sem a modelagem no plano ela roda
igual, só sem requisitos declarados para conferir um a um, e a degradação
aparece escrita no cartão, no terminal e no editor.

Com as duas juntas o ciclo fecha: cada requisito vira **cumprido**, **violado**
(com arquivo, linha e correção) ou **não deu para verificar** — e este último
caso é listado na tela em vez de ser omitido.

## Um motor, três interfaces

O StarGuard é um **orquestrador central** com **analisadores independentes**.
Cada um roda sozinho, diz por conta própria se o ambiente permite executá-lo, e
traz o seu **corretor embutido**. Dá para pedir só uma coisa ou tudo junto — e
o mesmo motor serve os três produtos:

| Onde | O que é | Precisa de |
|---|---|---|
| **Painel web** | Next, com histórico, PR e governança | Postgres |
| **Terminal** (`starguard`) | o mesmo motor, sem servidor | nada |
| **VS Code** | achados no painel Problemas, correção na lâmpada | nada |

```
app/  components/  lib/     painel web (Next)
  lib/sinks/postgres.ts     eventos do orquestrador → linhas no banco
packages/core/              @starguard/core — o motor (sem Next, React ou banco)
  contracts.ts                Analyzer, Fixer, Workspace, Sink
  orchestrator.ts             plano inspecionável + execução paralela
  registry.ts                 os analisadores, num lugar só
  workspace.ts                git (clone) ou local (disco)
  analyzers/                  threat · sast · sca · business · skills
  fix/                        maquinário compartilhado da correção
  i18n/  catalog/             os três idiomas, para os três produtos
packages/cli/               binário `starguard`
packages/vscode/            extensão
middleware.ts               authn/authz + rate limit + headers
db/migrations/              geradas por `npm run db:generate`
```

### No terminal

```bash
starguard scan .                     # tudo o que der, no diretório atual
starguard scan . --only sca          # só as dependências (Trivy)
starguard scan . --only sast         # só o código (Opengrep/Semgrep)
starguard skills ./minha-skill.md    # só a skill — sem repositório nenhum
starguard fix --all --severity high  # propõe correção (--write para gravar)
starguard doctor                     # o que está instalado e configurado
```

Códigos de saída: `0` limpo · `1` achado acima de `--fail-on` · `2` falha de
execução. Sem terminal interativo (CI, pipe), a saída vira linhas sequenciais,
sem nenhum código de escape — e `--json` / `--sarif <arquivo>` entregam o
resultado para máquina.

### No VS Code

Árvore lateral com um item por analisador e um ▶ em cada um; os achados vão
para o painel **Problemas** com `source: starguard/<analisador>`; a correção é
uma lâmpada que **mostra o diff antes de gravar**. Roda o motor localmente — o
código não sai da máquina, e funciona em projeto que ainda não foi enviado para
lugar nenhum.

## Scripts

```bash
npm run dev             # painel em desenvolvimento (gera chaves antes)
npm run build           # build de produção do painel
npm run build:packages  # núcleo → CLI → extensão, NESTA ordem
npm run cli -- doctor   # o binário do terminal, direto do repositório
npm test                # unidade: o painel E os pacotes, num comando só
npm run typecheck       # tsc --noEmit no painel + typecheck de cada pacote
npm run lint            # eslint (inclui a regra de fronteira do núcleo)
npm run gen:keys        # regenera chaves JWT + cookie secret
```

## Fora do MVP (próximos passos)

Ambiente de "uso" integrado ao IDE/terminal (VS Code); DAST (OWASP ZAP);
MFA (TOTP); rate limit em Redis/Upstash; persistência em banco (hoje o store é em memória).
