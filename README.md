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

## Estrutura

```
/app
  page.tsx                  Tela 1 · Onboarding
  login/page.tsx            Tela 0 · Login
  results/[id]/page.tsx     Tela 2 · Painel (polling das 4 fases)
  report/[id]/page.tsx      Tela 3 · Relatório exportável
  api/
    auth/{login,refresh,logout}   Argon2id + JWT + blocklist
    analyze  ·  status/[id]       cria job / polling
    step1-threat · step2-skills · step3-scan · step4-fix
    github/{clone,pr}             metadados + PR (Octokit)
    health
/middleware.ts              authn/authz + rate limit + headers
/lib
  config.ts   ai.ts   jwt.ts   auth.ts   ratelimit.ts   validation.ts
  http.ts     client.ts   jobs.ts   tasks.ts   fixtures.ts
  github.ts   sast.ts   sca.ts   skills.ts   parsers.ts   theme.ts   icons.ts
/components   AppShell · StepCard · VulnerabilityCard · SkillFindingCard ·
              SeverityBadge · RepoInput · ThreatInput · SkillInput · FixModal
/types/index.ts
```

## Scripts

```bash
npm run dev         # dev (gera chaves antes)
npm run build       # build de produção (inclui typecheck)
npm run typecheck   # tsc --noEmit
npm run gen:keys    # regenera chaves JWT + cookie secret
```

## Fora do MVP (próximos passos)

Ambiente de "uso" integrado ao IDE/terminal (VS Code); DAST (OWASP ZAP);
MFA (TOTP); rate limit em Redis/Upstash; persistência em banco (hoje o store é em memória).
