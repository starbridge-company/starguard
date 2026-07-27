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
| Qualquer coisa que apareça na tela | Chave nova em `lib/i18n/messages.ts`, nos **três** idiomas, e `t("chave")` no JSX |
| Texto com número/nome no meio | Use interpolação `{n}`, nunca concatenação — a ordem das palavras muda entre idiomas |
| Texto que o SERVIDOR grava no banco | `translate(locale, "chave")` de `lib/i18n/translate.ts` |
| Erro de rota | `jsonError(status, "texto pt-BR", "err.minhaChave")` + a chave nos três dicionários |
| Erro dinâmico (ferramenta externa, Zod) | `jsonError(status, msg, null)` — o `null` diz "não substitua, este texto É a informação" |
| Explicação de regra/CWE | `lib/catalog/{pt-BR,en,es}.ts` — as três com as **mesmas** chaves |

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

1. `LOCALES`, `LOCALE_LABEL` e `LOCALE_AI_NAME` em `lib/i18n/config.ts`, mais o
   ramo correspondente em `normalizeLocale`.
2. Dicionário completo em `lib/i18n/messages.ts` (o compilador cobra).
3. `lib/catalog/<locale>.ts` espelhando as chaves de `pt-BR.ts`, registrado em
   `lib/catalog/index.ts`.
4. `npm test` — a paridade dos dicionários e do catálogo é verificada.

O seletor de idioma da tela de Conta e o schema do Zod saem de `LOCALES`: não
há lista a repetir.

## Comandos

```bash
npm test              # unidade (vitest) — rápido, sem banco nem rede
npm run test:watch    # unidade em modo observação
npm run test:coverage # cobertura
npm run test:e2e      # navegador (ver e2e/README.md — precisa da app de pé)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (flat config; `next lint` não existe mais no Next 16)
npm run build         # build de produção
```

Antes de dar qualquer coisa por pronta: `npm run typecheck && npm run lint && npm test`.

## Onde as coisas estão

```
lib/            lógica de domínio — é aqui que mora o que precisa de teste de unidade
lib/repos/      acesso ao banco (Drizzle). Não testado por unidade: precisa de Postgres
lib/i18n/       dicionários e provider de idioma
tests/          testes de unidade (vitest). Um arquivo por módulo
e2e/            testes de navegador (Playwright). Não rodam no CI — ver e2e/README.md
db/migrations/  geradas por `npm run db:generate`. NUNCA editar à mão
AUDITORIA.md    achados, o que foi entregue e as pendências abertas
```

## Convenções que este código segue

- **Comentário explica _por quê_, não _o quê_.** Quando a decisão não é óbvia,
  registre a razão e cite o item da auditoria (`Ver AUDITORIA.md#SEC-01`).
- **Nada de `any`** — o ESLint trata como erro.
- **Mensagem de erro que chega ao usuário passa por `lib/redact.ts`.** Erro de
  ferramenta externa pode carregar credencial, e esse texto é persistido no
  JSONB `phases` e exibido na tela.
- **Texto visível vem de `lib/i18n/messages.ts`**, nunca literal no JSX — nem em
  `placeholder`, `title` ou `aria-label`. São três idiomas e nenhum é opcional:
  ver a seção "Idioma" acima.
- **Entrada de rota passa por Zod** (`lib/validation.ts`). Sem exceção.
- **Método que muda estado exige CSRF** (`requireCsrf`). As três rotas de auth
  são a única exceção, por desenho.
- **Chamada de IA custa dinheiro:** verifique se dá para resolver pelo catálogo
  (`lib/catalog.ts`) ou reaproveitar o que já foi gerado antes de chamar.

## Ao mexer na auditoria

`AUDITORIA.md` é o documento vivo do projeto. Ao entregar um item:

1. Marque o item com o que foi feito e a data.
2. Preencha a tabela "Como o sprint foi validado" com o resultado **medido**,
   não com a intenção.
3. Registre como `PEND-nn` tudo que ficou de fora — inclusive o que você não
   conseguiu exercitar. Uma pendência declarada vale mais que uma entrega que
   parece completa.
