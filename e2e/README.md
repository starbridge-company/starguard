# Testes ponta a ponta

Rodam contra a **aplicação de pé**, num navegador real (Chromium via Playwright).
São o complemento dos testes de unidade em `tests/`: aqui verificamos o que só
existe no browser — foco, ESC, cookies, sequência de requisições.

## Por que não estão no CI

Precisam de Postgres + build da imagem + repositório do GitHub acessível. Rodar
isso a cada push custaria minutos e traria instabilidade de rede para dentro do
sinal de build. O CI roda `typecheck`, `lint`, os testes de unidade e o build da
imagem; o ponta a ponta é executado sob demanda antes de um deploy.

## Como rodar

```bash
# 1. banco descartável
docker run -d --name sg-pg -e POSTGRES_PASSWORD=sgtest -e POSTGRES_DB=starguard \
  -p 5433:5432 postgres:16-alpine

# 2. schema + usuários demo
DATABASE_URL="postgres://postgres:sgtest@localhost:5433/starguard" npm run db:migrate:prod
DATABASE_URL="postgres://postgres:sgtest@localhost:5433/starguard" npm run db:seed

# 3. app (porta 3020, cookies sem HTTPS)
DATABASE_URL="postgres://postgres:sgtest@localhost:5433/starguard" \
  SESSION_SECURE=false PORT=3020 npm run dev

# 4. navegador + testes
npm i -D playwright && npx playwright install chromium
npm run test:e2e
```

## O que cada arquivo cobre

| Arquivo | Verifica |
|---|---|
| `sessao.mjs` | **BUG-01** — remove o cookie de acesso mantendo o refresh e confirma a sequência `401 → refresh → repete`, sem cair no login |
| `fluxo-correcao.mjs` | **UX-01/02/04/05 · FEAT-01/02** — filtros, paginação, estado do achado, diff, cache de correção, acessibilidade do modal, confirmação do lote |
| `idioma.mjs` | **FEAT-04** — `Accept-Language` na primeira visita, troca de idioma, persistência em cookie |

`fluxo-correcao.mjs` e `idioma.mjs` dependem de uma análise existente: ajuste a
constante `ID` no topo do arquivo para uma análise real da sua base, ou rode o
fluxo de criação antes.
