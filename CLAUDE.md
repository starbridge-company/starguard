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
- **Texto visível vem de `lib/i18n/messages.ts`**, nunca literal no JSX. O
  português é a referência; o inglês pode estar incompleto e cai nele.
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
