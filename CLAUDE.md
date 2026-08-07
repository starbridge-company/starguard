# StarGuard — instruções para trabalhar neste repositório

## Regra principal: toda mudança entra com teste

**A partir de agora, nenhuma alteração de comportamento é considerada pronta sem
teste automatizado.** Isto não é preferência de estilo — é consequência direta da
auditoria: os seis primeiros sprints foram validados à mão contra containers, e
nada daquilo estava protegido contra regressão (`AUDITORIA.md#PEND-08`).

O que isso significa na prática:

| Tipo de mudança | Teste obrigatório |
|---|---|
| Correção de bug | Um teste que **falha antes** da correção e passa depois. Cite o item da auditoria no `describe`. |
| Lógica pura (parser, validação, cálculo, formatação) | Unidade em `tests/*.test.ts` |
| Regra de segurança (auth, rate limit, redação, allowlist) | Unidade cobrindo o caminho **negativo** — o que deve ser recusado |
| Fluxo de tela | Suíte em `e2e/` (navegador real) |
| Schema do banco | Migração + o teste do repositório que a consome |

Exceções aceitáveis, e só estas: texto puro, estilo/CSS sem lógica, e comentários.
Se for abrir exceção, diga qual e por quê — não deixe implícito.

### Por que o teste vem junto e não depois

Dois bugs deste projeto só apareceram porque alguém foi verificar:

- `hasFix` voltava sempre `false` — a subconsulta correlacionada do Drizzle
  rendia zero. O SQL equivalente funcionava no psql. Só o navegador revelou.
- O contador `truncated` da cobertura da revisão por IA nunca era incrementado;
  quem apontou foi o `prefer-const` do ESLint.

Nenhum dos dois quebrava o build ou os tipos.

## Idioma: três, sem exceção

**O sistema fala português (Brasil), inglês e espanhol.** Não há texto de
segunda classe: placeholder, título, botão, rótulo de coluna, `aria-label`,
`title`, mensagem de erro, InfoTip, texto de confirmação, corpo de Pull Request
e cabeçalho de planilha exportada seguem o idioma escolhido pela pessoa.

O idioma vem de **cookie** (`sg_locale`), com a preferência salva na conta
(`users.locale`) e `Accept-Language` na primeira visita. Não há prefixo de URL,
e por isso não há biblioteca de i18n: o que uma lib entregaria (roteamento) não
se aplica aqui.

### Onde mexer para acrescentar texto

| Você está escrevendo | Faça |
|---|---|
| Qualquer coisa que apareça na tela | Chave nova em `packages/core/src/i18n/messages.ts`, nos **três** idiomas, e `t("chave")` no JSX |
| Texto do TERMINAL ou da extensão do VS Code | A mesma coisa. O dicionário é um só para os três produtos; `--lang` e `starguard.locale` escolhem |
| Texto com número/nome no meio | Use interpolação `{n}`, nunca concatenação — a ordem das palavras muda entre idiomas |
| Texto que o SERVIDOR grava no banco | `translate(locale, "chave")` de `lib/i18n/translate.ts` |
| Erro de rota | `jsonError(status, "texto pt-BR", "err.minhaChave")` + a chave nos três dicionários |
| Erro dinâmico (ferramenta externa, Zod) | `jsonError(status, msg, null)` — o `null` diz "não substitua, este texto É a informação" |
| Explicação de regra/CWE | `packages/core/src/catalog/{pt-BR,en,es}.ts` — as três com as **mesmas** chaves |

O dicionário mora em `packages/core/src/i18n/`. `lib/i18n/config.ts`,
`messages.ts` e `translate.ts` continuam existindo como reexportação — o
endereço `@/lib/i18n/*` que o app já usa segue valendo, e o terminal e o VS
Code leem o MESMO dicionário sem carregar o app Next junto.

`lib/i18n/index.tsx` é `"use client"`. O servidor **não** pode importar dele:
use `lib/i18n/translate.ts`, que é puro. Isso não é preferência de organização —
importar um módulo cliente do servidor devolve uma referência que não dá para
chamar, e o erro só aparece em runtime.

### O que o tipo já garante (e o que ele não garante)

`EN` e `ES` são `Record<MessageKey, string>` **completos**, não `Partial`. Chave
nova em português que ninguém traduziu **não compila**. O que o tipo não pega —
e por isso tem teste em `tests/i18n.test.ts` e `tests/i18n-server.test.ts`:

- valor vazio ou marcador de interpolação divergente entre idiomas;
- frase longa copiada do português (tradução esquecida);
- literal solto no JSX e em `placeholder`/`title`/`aria-label`;
- texto gravado pelo servidor sem chave de tradução.

### Decisões que já foram tomadas — não desfaça sem motivo

- **Texto gravado no JSONB `phases` sai já traduzido**, no idioma de quem pediu
  a análise. Ele é escrito uma vez e lido do banco para sempre; não passa por
  `t()` na exibição. Vale para `phases[].error`, `sast.note`, os rótulos de
  checagem de skill e os achados heurísticos.
- **Achado heurístico de skill carrega `titleKey` + `title`.** A chave é a
  fonte para a tela; o texto fica para as análises gravadas antes disso e para
  quem lê o JSONB sem o dicionário.
- **CSV é traduzido, JSON não.** Quem abre o CSV é uma pessoa no Excel; quem
  consome o JSON é um pipeline, e mudar as chaves conforme o idioma quebraria o
  consumidor do outro lado. Está fixado em `tests/export.test.ts`.
- **A tela mostra a CHAVE traduzida do erro, não `err.message`.** Use
  `useApiError()`, nunca `err instanceof ApiError ? err.message : t("...")` —
  esse padrão mostrava a mensagem do servidor, que é escrita em português.
- **`PhaseState.label` é interno** e nunca é renderizado. Se for exibir, vire
  chave antes.

### Acrescentando um quarto idioma

1. `LOCALES`, `LOCALE_LABEL` e `LOCALE_AI_NAME` em
   `packages/core/src/i18n/config.ts`, mais o ramo em `normalizeLocale`.
2. Dicionário completo em `packages/core/src/i18n/messages.ts` (o compilador cobra).
3. `packages/core/src/catalog/<locale>.ts` espelhando as chaves de `pt-BR.ts`,
   registrado em `catalog/index.ts`.
4. `npm test` — a paridade dos dicionários e do catálogo é verificada.

O idioma novo vale nos três produtos de uma vez: o `--lang` do terminal e o
`starguard.locale` do VS Code saem da mesma `LOCALES`.

O seletor de idioma da tela de Conta e o schema do Zod saem de `LOCALES`: não
há lista a repetir.

## Arquitetura: um motor, três interfaces

**O StarGuard não é mais um pipeline.** É um **orquestrador central** que
recebe uma seleção de analisadores e uma origem de código. Dá para rodar
apenas uma skill, apenas o Trivy, apenas as regras de negócio, apenas o
Semgrep, ou tudo junto — e o mesmo motor serve o **painel web**, o **terminal**
e a **extensão do VS Code**. Ver `AUDITORIA.md#ARQ-13`.

```
app/  components/  lib/     app Next (o painel — continua na raiz)
  lib/sinks/postgres.ts     ÚNICO lugar do caminho de análise que sabe de Drizzle
packages/core/              @starguard/core — o motor. Sem Next, React, Drizzle ou Zod
packages/cli/               binário `starguard`
packages/vscode/            extensão
```

### As cinco regras que sustentam isso

1. **O núcleo não conhece o app.** `packages/core` não pode importar `next`,
   `react`, `drizzle-orm`, `pg`, `zod` nem o alias `@/`. Isso é verificado
   duas vezes — `packages/core/tests/boundary.test.ts` e `no-restricted-imports`
   no ESLint — porque esse erro **não quebra tipo nem build**: ele aparece só
   quando alguém roda `starguard` no terminal.

2. **Imports relativos do núcleo vão SEM extensão.** O Turbopack (que o Next 16
   usa em dev e no build) não resolve `./x.js` para `x.ts`, e não há
   configuração para isso. As extensões que o ESM do Node exige são
   acrescentadas na emissão, por `packages/core/scripts/add-extensions.mjs`.

3. **A correção mora dentro do analisador que achou o problema.** Cada
   `Analyzer` traz o seu `Fixer`. Não há corretor genérico do lado de fora —
   o maquinário compartilhado (`fix/code.ts`, `fix/agent.ts`) é composto por
   eles, não chamado por cima deles.

4. **`propose` nunca escreve; só `apply` grava.** É o que permite o modal, o
   `--dry-run` e o `vscode.diff` usarem o mesmo código sem risco.

5. **Dependência entre analisadores é enriquecimento, não pré-requisito.**
   `uses` que não está no plano degrada o resultado e é **registrado**; nunca
   arrasta o outro analisador para dentro da execução. Tratar `uses` como
   requisito rígido devolve o pipeline linear pela porta dos fundos.

### Acrescentando um analisador

1. `packages/core/src/analyzers/<id>.ts` implementando `Analyzer` (com o
   `Fixer`, ou com um comentário dizendo por que não há um).
2. Registrar em `packages/core/src/registry.ts` e no `ANALYZER_IDS` de
   `types.ts`.
3. `analyzer.<id>.name` e `.desc` nos **três** idiomas.
4. Se ele produzir achados que o painel exibe, mapear a fase em `compat.ts`.

O seletor da Tela 1, o `starguard list`, o `doctor` e a árvore do VS Code saem
todos do registro — nenhum deles precisa ser tocado.

### Indisponível aparece COM o motivo, nunca ausente

Analisador que não pode rodar sai do plano com uma `UnavailableReason`, que é
**chave de tradução**, não frase. Some da execução, não da tela: o cartão fica
desabilitado com o motivo, o terminal imprime a linha, o editor mostra no
tooltip. É a mesma exigência do `UX-15` — nunca confundir "não encontrou" com
"não procurou" — estendida a "não dá para procurar, e eis o porquê".

## Comandos

```bash
npm test              # unidade (vitest) — cobre o app E os pacotes, num comando só
npm run test:watch    # unidade em modo observação
npm run test:coverage # cobertura
npm run test:e2e      # navegador (ver e2e/README.md — precisa da app de pé)
npm run typecheck     # tsc --noEmit no app + `typecheck` de cada pacote
npm run lint          # eslint (flat config; `next lint` não existe mais no Next 16)
npm run build         # build de produção do painel
npm run build:packages  # núcleo → CLI → extensão, NESTA ordem (o CLI usa o dist do núcleo)
npm run cli -- doctor   # o binário do terminal, direto do repositório
```

Antes de dar qualquer coisa por pronta: `npm run typecheck && npm run lint && npm test`.

### Mexeu em `packages/vscode/`? Suba a alteração na MESMA tarefa

Alterar a extensão e parar no `npm test` **não entrega nada**. O que está
instalado no editor continua sendo o bundle anterior: quem abrir a barra
lateral para conferir vê a versão velha e conclui que a mudança não funcionou.
Testes verdes e um `.vsix` velho instalado é o pior dos dois mundos — parece
pronto e não está.

Toda mudança na extensão termina com estes três passos, nesta ordem:

```bash
# 1. SUBIR A VERSÃO em packages/vscode/package.json (patch, sempre)
npm run build:packages                      # 2. o NÚCLEO primeiro: o bundle da extensão lê o dist dele
npm run install:local -w starguard-vscode   # 3. empacota o .vsix e SUBSTITUI a instalação da máquina
```

Depois avise que a janela precisa de **Developer: Reload Window** — o extension
host carrega o bundle uma vez e não o relê sozinho.

**A versão sobe SEMPRE, mesmo em correção de uma linha.** Reinstalar `0.2.0`
por cima de `0.2.0` é uma operação que o editor tem todo o direito de tratar
como "já tenho essa" — e quando ele o faz, o sintoma é o pior possível: os
comandos rodam sem erro, o `.vsix` é gerado, e o que está no editor continua
sendo o bundle velho. O número na aba de Extensões é também a única forma de
alguém CONFERIR, sem abrir terminal, que está olhando a versão nova. Sem ele,
"não funcionou" e "não instalou" ficam indistinguíveis.

Três armadilhas que já custaram tempo aqui:



- **A ordem não é opcional.** `install:local` roda o esbuild sobre o `dist` do
  núcleo, não sobre o `src`. Pular o `build:packages` empacota a extensão com a
  versão anterior do motor, e o sintoma é uma mudança no núcleo que "não fez
  efeito nenhum".
- **Não use `code --install-extension --force` à mão.** O `--force` não remove
  a versão anterior; cada instalação deixa a sua pasta em `~/.vscode/extensions`
  e o editor MESCLA as contribuições de todas — o painel aparece duplicado e
  parece bug da extensão. É por isso que existe `scripts/instalar-local.mjs`,
  que desinstala, instala e só então limpa as pastas órfãs. Ver o cabeçalho do
  script.

## Onde as coisas estão

```
lib/                    o que é do app web: rotas, sessão, banco, provider de idioma
lib/sinks/postgres.ts   os eventos do orquestrador viram linhas no Postgres
lib/repos/              acesso ao banco (Drizzle). Não testado por unidade: precisa de Postgres
packages/core/src/
  contracts.ts          Analyzer, Fixer, Workspace, Sink — é aqui que "independente" se define
  orchestrator.ts       plano inspecionável antes de rodar + execução
  registry.ts           um lugar só; o seletor, o `list` e a árvore saem daqui
  workspace.ts          git (clone) ou local (disco), com leitura confinada à raiz
  analyzers/            um arquivo por analisador, cada um com o seu Fixer
  fix/                  maquinário compartilhado da correção
  compat.ts             ponte para o formato de fases gravado no banco
  i18n/                 dicionários dos três idiomas — fonte para os três produtos
packages/cli/src/       parser de flags, renderizador ANSI, comandos
packages/vscode/src/    árvore, diagnósticos, lightbulb
tests/                  unidade do app. packages/*/tests/ — unidade dos pacotes
e2e/                    testes de navegador (Playwright). Ver e2e/README.md
db/migrations/          geradas por `npm run db:generate`. NUNCA editar à mão
AUDITORIA.md            achados, o que foi entregue e as pendências abertas
```

## Convenções que este código segue

- **Comentário explica _por quê_, não _o quê_.** Quando a decisão não é óbvia,
  registre a razão e cite o item da auditoria (`Ver AUDITORIA.md#SEC-01`).
- **Nada de `any`** — o ESLint trata como erro.
- **Mensagem de erro que chega ao usuário passa por `redact.ts` do núcleo.** Erro de
  ferramenta externa pode carregar credencial, e esse texto é persistido no
  JSONB `phases` e exibido na tela.
- **Texto visível vem de `packages/core/src/i18n/messages.ts`**, nunca literal no JSX — nem em
  `placeholder`, `title` ou `aria-label`. São três idiomas e nenhum é opcional:
  ver a seção "Idioma" acima.
- **Entrada de rota passa por Zod** (`lib/validation.ts`). Sem exceção.
- **Método que muda estado exige CSRF** (`requireCsrf`). As três rotas de auth
  são a única exceção, por desenho.
- **Chamada de IA custa dinheiro:** verifique se dá para resolver pelo catálogo
  (`packages/core/src/catalog/`) ou reaproveitar o que já foi gerado antes de
  chamar. O seletor de analisadores existe pelo mesmo motivo: rodar só o que se
  precisa é a economia mais direta que há.

## Regra que vale mais que a auditoria: RESOLVA, não registre

**Bug ou pendência que você encontrar, você conserta — na mesma sprint.** Não
existe "anoto agora e resolvo depois". A sprint não termina com item aberto.

Isto é correção de rumo, não preferência: o `AUDITORIA.md` acumulou mais de
trinta pendências abertas, e registrar virou substituto de consertar. O
documento passou a dar impressão de rigor enquanto o produto seguia quebrado.
Uma `PEND-nn` nova é quase sempre trabalho que você decidiu não fazer.

A **única** exceção é depender de algo que você não tem como obter — credencial
de terceiro, GitHub App, publicação em marketplace, navegador com pessoa na
frente. Nesse caso diga o motivo concreto ("preciso de um App ID que só você
cria"), nunca "fica para a próxima".

Achou um defeito no meio de outra tarefa? Conserte junto, com teste. É mais
barato que a ida e volta de registrar, explicar e retomar o contexto depois.

## Ao mexer na auditoria

`AUDITORIA.md` é o documento vivo do projeto. Ao entregar um item:

1. Marque o item com o que foi feito e a data.
2. Preencha a tabela "Como o sprint foi validado" com o resultado **medido**,
   não com a intenção.
3. O que ficou de fora entra como pendência **só** se cair na exceção acima.
   Fora dela, resolva antes de dizer que terminou.
