# StarGuard — Auditoria Técnica e Plano de Ação

> Vistoria completa do código (10.492 linhas de TS/TSX + 3.157 de CSS), feita arquivo por
> arquivo em 26/07/2026. Cada item foi **verificado no código** antes de entrar aqui; o que
> não deu para confirmar está marcado como hipótese.

---

## Como usar este documento

Cada item tem **ID**, **prioridade**, **esforço**, **evidência** (arquivo:linha), o que
acontece **hoje**, o que **deveria** acontecer, **como corrigir** e **critério de aceite**.
Trabalhe de cima para baixo: a ordem dos blocos é a ordem de execução recomendada.

| Campo | Valores |
|---|---|
| **Prioridade** | `P0` trava o uso · `P1` pedido explícito ou risco alto · `P2` melhoria relevante · `P3` evolução |
| **Esforço** | `P` ≤2h · `M` ~1 dia · `G` 2–5 dias · `GG` >1 semana |
| **Prefixo** | `BUG` lógica · `SEC` segurança · `UX` interface · `FEAT` funcionalidade · `ARQ` arquitetura |
| **Status** | ✅ confirmado no código · ⚠️ confirmado por leitura, sem execução · 💡 proposta |

**Placar:** 22 bugs · 9 itens de segurança · 21 de UX/UI · 8 features · 11 de arquitetura = **71 itens**.

## Progresso

| Sprint | Itens | Situação |
|---|---|---|
| **1 — Destravar o uso** | BUG-01 · BUG-02 · BUG-03 · BUG-04 · BUG-05 · BUG-09 · SEC-01 · SEC-04 · SEC-05 · SEC-07 · SEC-08 (parcial) | ✅ **entregue e testado** em 27/07/2026 |
| **2 — Fluxo de correção** | BUG-06 · BUG-07 · BUG-08 · BUG-10 · SEC-02 · SEC-03 · UX-15 | ✅ **entregue e testado** em 27/07/2026 |
| **3 — Estado e cache** | FEAT-01 · FEAT-02 | ✅ **entregue e testado** em 27/07/2026 |
| **4 — Interface** | UX-01 · UX-02 · UX-04 · UX-05 · UX-06 | ✅ **entregue e testado em navegador** em 27/07/2026 |
| **5 — Descrições** | FEAT-03 · ARQ-11 | ✅ **entregue e testado em navegador** em 27/07/2026 |
| **6 — Idioma** | FEAT-04 | 🟡 **fundação entregue e testada; extração parcial** em 27/07/2026 |
| **Contínuo — Qualidade** | ARQ-01 · ARQ-02 · ARQ-03 · BUG-17 | ✅ **entregue** em 27/07/2026 |
| 7 em diante | backlog P2/P3 do documento + pendências | ⬜ a fazer |

<details>
<summary><strong>Como a fase Contínuo foi validada</strong></summary>

| Verificação | Resultado |
|---|---|
| `npm test` | **59 testes em 7 arquivos**, 2,7 s, sem banco nem rede |
| `npm run lint` | **0 erros** (11 avisos da regra nova do React — ver PEND-20) |
| `npm run typecheck` | limpo |
| Cobertura dos módulos testados | `catalog` 100% · `fingerprint` 100% · `redact` 100% · `validation` 93% · `diff` 93% · `ratelimit` 88% · `pagination` 88% · `parsers` 76% |

**Cada teste cita o item da auditoria que protege** — `redact · SEC-01`,
`rateLimit · BUG-02`, `clientIp · SEC-04`, `fingerprint · FEAT-01`,
`diff · UX-02`, `step4Schema · BUG-06`, `catálogo · FEAT-03`,
`translate · FEAT-04`. Regressão em qualquer um deles aparece pelo nome.

**Dois defeitos encontrados pela própria montagem da fase:**
- `prefer-const` denunciou que o contador `truncated` da cobertura da revisão
  por IA (UX-06) **nunca era incrementado** — o `truncated++` se perdeu numa
  edição do Sprint 4 e a tela sempre reportaria zero arquivos truncados.
- `npm run lint` chamava `next lint`, removido no Next 16 (BUG-17): o comando
  simplesmente não existia.

**Ferramental:** vitest (unidade), ESLint 9 com flat config nativo do
`eslint-config-next` (o FlatCompat não sobrevive ao ESLint 10), GitHub Actions
com `typecheck + lint + testes + build da imagem` e um passo de **dogfooding**
rodando o Opengrep sobre o próprio repositório. As actions do workflow estão
fixadas por SHA — que é exatamente o achado que este produto reporta.
</details>

<details>
<summary><strong>Como o Sprint 6 foi validado</strong> (Chromium com <code>Accept-Language: en-US</code>)</summary>

| Verificação | Resultado |
|---|---|
| Primeira visita, navegador em inglês | `<html lang="en">` e login em inglês **sem configurar nada** |
| Menu lateral | "New analysis · Analyses · Pull Requests · Account · Sign out" |
| Troca explícita para português | `<html lang>` vira `pt-BR`, menu volta, cookie `sg_locale=pt-BR` gravado |
| Persistência | escolha sobrevive à navegação e à recarga |
| Volta para inglês | menu traduzido de novo |
| Erros de JavaScript | **0** |

**O que ficou traduzido:** fundação completa (detecção por `Accept-Language`, cookie,
`<html lang>`, provider, `t()` com interpolação e fallback), login, menu, tela de
resultados, cards de achado, modal de correção, diff, selos de severidade e de estado,
formatação de datas — e a **saída da IA**: modelagem de ameaças, revisão, enriquecimento e
explicação de correção passaram todos a receber o idioma, com a análise carregando essa
escolha até o fim do job.
</details>

<details>
<summary><strong>Como o Sprint 5 foi validado</strong></summary>

| Verificação | Resultado |
|---|---|
| Cobertura do catálogo num repositório real | **44 de 44** achados explicados pelo catálogo — **zero chamadas de IA** |
| Título do card | `An action sourced from a third-party repository on GitHub is not pinned to a full length commit SHA…` → **"GitHub Action de terceiro não fixada em commit"** |
| Descrição | passa a dizer o que é, por que importa e o caminho de ataque, em português |
| "Como corrigir" | orientação específica por regra, no lugar da frase fixa que era igual para todos |
| Divulgação progressiva | trecho de código, cenário de ataque e texto original ficam num `Collapsible` |
| Rastreabilidade | o texto original da ferramenta continua acessível — não escondemos a fonte |
| Erros de JavaScript | **0** |

**Custo:** o catálogo tem 38 entradas (24 regras + 14 CWEs) e resolve as regras mais
comuns de graça. A IA entra **em lote**, uma única chamada para todas as regras
desconhecidas de uma vez — num repositório com 44 achados de 5 regras distintas, o
desenho evita 44 chamadas.
</details>

<details>
<summary><strong>Como o Sprint 4 foi validado</strong> (Chromium real, via Playwright — 20 verificações)</summary>

| Verificação | Resultado |
|---|---|
| Lista de correções | renderiza **25 cards por vez**; "Mostrar mais" completa os 44 |
| Filtro de severidade | Baixa → 3 cards; Crítica → 0 + estado vazio **de filtro** (não o "🎉 tudo limpo") |
| Busca por regra | `package-dependencies` → 19 cards |
| Filtro de origem | SAST 25 · Revisão IA 0 |
| Marcar "Falso positivo" | contador "Abertos (42)" → "(41)"; card aparece em Resolvidos com estilo próprio |
| Modal | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` presentes |
| Rolagem do fundo | travada ao abrir, restaurada ao fechar |
| Armadilha de foco | após **25 Tabs** o foco continua dentro do diálogo |
| ESC | fecha o modal |
| Diff | 14 linhas na tela · contador **+4 −2** · alternância diff/arquivo completo |
| Cache de correção | abrir o modal fez **1** chamada a `/api/step4-fix` e ela voltou do banco |
| Lote | mostra o custo em chamadas de IA e **não gera nada** até o clique explícito |
| Polling com análise concluída | **0 requisições** a `/api/status` em 12 s |
| Erros de JavaScript | **0** no console, em todo o percurso |

**Não exercitado:** o aviso de cobertura da revisão por IA (`UX-06`) só aparece quando a
revisão roda, o que exige chave de IA — o caminho de dados foi validado por tipo e build.
</details>

<details>
<summary><strong>Como o Sprint 3 foi validado</strong> (duas análises reais do mesmo repositório)</summary>

| Verificação | Resultado |
|---|---|
| Análise 1 de um repositório real | **55 achados persistidos** (44 SAST + 11 SCA), todos `open` |
| Marcar 3 achados (`fixed`, `false_positive`, `accepted_risk`) | HTTP 200 em cada |
| **Análise 2 do mesmo repositório** | 55 achados · **3 herdados** com estado e nota · **52 abertos** |
| Herança é por impressão digital? | `inherited_from` aponta para as linhas da análise 1, casadas por `fingerprint` |
| `POST /api/step4-fix` sem correção guardada | 502 (foi à IA, sem key configurada) |
| Mesmo POST **com** correção guardada | **200 · `cached: true`** — nenhuma chamada de IA |
| Mesmo POST com `force: true` ("Refazer") | 502 — ignorou o cache e foi à IA, como deve |
| Outro usuário lendo achados alheios | 404 em `GET /findings`, `PATCH /findings/:id` e `step4-fix` |
| `PATCH` sem header CSRF / com status inválido | 403 / 400 |

**Não exercitado:** a interface (filtro Abertos/Resolvidos, selo de estado, botões
"Já corrigi"/"Falso positivo", carregamento da correção guardada ao reabrir o modal) foi
validada por tipo e build, não em navegador. E a **gravação** da correção no fluxo real
depende de chave de IA — o registro usado no teste de cache foi inserido à mão.
</details>

<details>
<summary><strong>Como o Sprint 2 foi validado</strong></summary>

| Verificação | Resultado |
|---|---|
| Superadmin **rebaixado** com sessão aberta | `/api/admin/*` → 403 **na hora** (antes: 15 min) e refresh → 401 (antes: 7 dias) |
| Usuário **promovido** | sessão antiga derrubada — precisa entrar de novo para receber o papel novo |
| Usuário **excluído** | refresh → 401; não entra mais |
| Troca de senha em 2 dispositivos | o que trocou continua (200); o outro é derrubado (401) |
| `alsoFix` com vários achados do mesmo arquivo | aceito (502 = falhou só na IA por falta de key); payload malformado → 400 |
| Fim do job com `prs_count = 7` | continua 7 (antes: voltava a 0) |
| Scan com `SAST_ENGINE=none` | `ran: false` + nota — a tela deixa de comemorar 🎉 |
| Scan com **SCA quebrado** e SAST normal | SAST entrega 44 achados mesmo assim (antes: o SCA quebrado derrubava a fase inteira) |
| Scan real de repositório público | SAST 44 achados · SCA 11 CVEs — caminho completo funcionando no container |

**Não exercitado:** o agrupamento por arquivo do `BatchFixModal` e o aviso de `noChange`
dependem de uma chave de IA para gerar correções de verdade. O **contrato** (schema, prompt
com N achados, montagem do PR com um arquivo por grupo) está validado; o resultado da IA
sobre múltiplos achados no mesmo arquivo, não.
</details>

<details>
<summary><strong>Como o Sprint 1 foi validado</strong> (aplicação real em container + Postgres descartável)</summary>

| Verificação | Resultado |
|---|---|
| 20 logins **corretos** seguidos | 20 × HTTP 200 — antes o 6º dava 429 |
| 10 senhas erradas + 11ª | 10 × 401, 11ª → 429 — força bruta segue barrada |
| Login certo depois de 5 falhas | zera o histórico: as 10 falhas seguintes voltam a ser permitidas |
| 12 falhas com `X-Forwarded-For` **diferente** a cada uma | bloqueado na 11ª — o spoof não cria mais balde novo |
| 150 chamadas a `/api/status/*` | 150 × 200 — polling não consome mais a cota |
| 120 chamadas a `/api/analyses` | 429 a partir da 99ª — o limite global continua protegendo |
| `POST /api/auth/refresh` | 200, token rotacionado, **antigo revogado** (401), novo válido (200) |
| Trilha de auditoria | `ip_hash` preenchido; **0 registros** com IP legível no `meta` |
| `step1-threat` sem header CSRF | 403 (antes: aceitava e gastava IA) |
| Redação de segredos | 6 casos, incluindo a mensagem real do `git` com PAT — nenhum vazamento |
| Análise ponta a ponta | 4 fases concluem; a que não tem chave de IA degrada com mensagem clara |

**Não exercitado em navegador:** a renovação automática no cliente (retry em 401) e o
keepalive do `AppShell` foram validados apenas pelo lado do servidor — o contrato do
`/api/auth/refresh` funciona e o cliente o chama, mas não houve teste com navegador real.
</details>

---

## Sumário executivo — a causa raiz do seu "too many requests"

O 429 com pouquíssimos logins **não é um bug, são três se somando**. A cadeia, validada:

```
1. Você entra.                    Access token dura 15 min  (lib/auth.ts:155)
2. 15 min depois, o token expira. NADA renova a sessão      (nenhum código chama
                                  /api/auth/refresh — a rota existe e é órfã)
3. O middleware te joga no /login. Você entra de novo.       (middleware.ts:65-71)
4. Cada login gasta DOIS baldes de rate limit               (middleware.ts:40 + login/route.ts:24)
5. O balde é 5 por 15 minutos e conta login CERTO também.   (lib/config.ts:96)
   → No 6º login: 429 por 15 minutos.
```

Simulação com a sua configuração real (`LOGIN_RATE=5/15m`):

```
login #1..#5: OK
login #6:     429 no MIDDLEWARE — bloqueado por 15 min
buckets: login:<ip> = 7   |   login:<email>:<ip> = 5
```

**~75 minutos de trabalho normal esgotam a cota.** Some a isso o polling da tela de
resultados (1 request a cada 1,4 s) e a busca sem debounce (1 request por tecla digitada),
que consomem o limite global de 100/min, e o app fica intransitável. Corrigir
`BUG-01`, `BUG-02` e `BUG-03` resolve a dor inteira — é meio dia de trabalho.

---

## Pendências abertas dos sprints entregues

> O que ficou de fora do que já foi marcado como corrigido. Cada linha é
> rastreável por ID e deve ser fechada antes de considerar o item concluído.

| ID | Origem | O que falta | Por quê / o que fazer |
|---|---|---|---|
| **PEND-01** | SEC-08 (S1) | Backend Redis do rate limit | Só o vazamento de memória foi resolvido. Com 2+ instâncias no Render o limite efetivo dobra e fica imprevisível. `RATE_LIMIT_REDIS_URL` continua sendo lido por ninguém. |
| ~~PEND-02~~ | BUG-01 (S1) | ✅ **fechada em 27/07/2026** | Verificado em Chromium removendo o cookie de acesso e mantendo o refresh: a sequência observada foi `401 /api/findings/…` → `200 /api/auth/refresh` → `200 /api/findings/…`, sem passar pelo login. Falta apenas ver o keepalive de 5 min disparar por tempo — o caminho que ele usa é o mesmo já provado. |
| ~~PEND-03~~ | BUG-04/BUG-05 (S1) | ✅ **fechada em 27/07/2026** | O aviso de "conexão instável", o botão de retry e o debounce das buscas foram validados só por leitura e tipo. |
| **PEND-04** | BUG-08 (S2) | Incremento real do contador | Testei apenas **metade**: que o fim do job não zera mais o `prs_count`. O incremento em `createPR` (0 → 1 ao abrir um PR) nunca rodou, porque exige um PR de verdade no GitHub. |
| **PEND-05** | BUG-06/BUG-10 (S2) | Qualidade da correção agrupada | O contrato está validado (schema, prompt com N achados, PR com um arquivo por grupo), mas **nenhuma correção real foi gerada** — exige `ANTHROPIC_API_KEY`. Falta ver se a IA de fato resolve os N problemas do arquivo numa passada. |
| **PEND-06** | BUG-07 (S2) | PR multi-arquivo do agente | Exige chave de IA + token do GitHub + repositório real. O caminho de código está pronto e tipado; nunca foi executado. |
| **PEND-07** | SEC-02 (S2) | Janela de 15 min fora da área de governança | `requireRole` reconfere o papel no banco, mas `requireSession` (rotas comuns) não. Um usuário excluído mantém acesso aos **próprios** dados até o access token expirar. Decisão consciente: uma consulta por requisição em toda a API era caro demais para o ganho. |
| **PEND-08** | ARQ-01 | Nenhum teste automatizado | Todas as validações foram feitas à mão contra um container. Nada disso está protegido contra regressão. É a maior dívida aberta. |
| ~~PEND-09~~ | FEAT-01/02 (S3) | ✅ **fechada em 27/07/2026** — filtros, selos, ações de estado, modal e cache exercitados em Chromium real | Filtro Abertos/Resolvidos, selos de estado, botões "Já corrigi"/"Falso positivo" e carregamento da correção guardada ao reabrir o modal: validados por tipo e build, não em uso real. |
| **PEND-10** | FEAT-02 (S3) | Gravação da correção no fluxo real | O cache foi provado com um registro inserido à mão. Ver a IA gerar → gravar → reaproveitar exige `ANTHROPIC_API_KEY`. |
| **PEND-11** | FEAT-01 (S3) | Análises antigas não têm estado | Achados só passam a existir na tabela a partir de agora. Análises anteriores continuam funcionando, mas sem os controles de estado. Se quiser retroagir, é um backfill lendo o JSONB `phases`. |
| **PEND-13** | FEAT-03 (S5) | Caminho de IA do enriquecimento não exercitado | O catálogo cobriu 100% do repositório testado, então a chamada em lote a `lib/enrich.ts` nunca rodou. Exige `ANTHROPIC_API_KEY` **e** um repositório com regras fora do catálogo. |
| **PEND-14** | FEAT-03 (S5) | Catálogo cobre só as regras mais comuns | 38 entradas. Repositórios de outras linguagens (Python, Go, Java) vão cair mais na IA. Ampliar o catálogo é trabalho incremental e barato — cada entrada nova economiza chamadas para sempre. |
| **PEND-15** | FEAT-03 (S5) | Dependências (SCA) não são enriquecidas | O enriquecimento cobre SAST e revisão por IA. Achados de CVE mantêm a descrição do Trivy, em inglês. |
| **PEND-16** | FEAT-04 (S6) | Extração de strings incompleta | Traduzidos: login, menu, resultados, cards, modal de correção, diff, severidade/estado, datas. **Faltam:** corpo da tela de Conta, as 4 telas de governança, lista de análises, relatório, onboarding (`app/page.tsx`), `PipelineStepper`, `BatchFixModal`, `NewUserModal`, `filters.tsx`, `listing.tsx` e o conteúdo dos `InfoTip`. A fundação está pronta — o resto é trabalho mecânico de trocar literal por `t()`. |
| **PEND-17** | FEAT-04 (S6) | Mensagens de erro da API em pt-BR fixo | `jsonError(401, "Não autenticado.")` e afins. O desenho previsto é devolver uma CHAVE e traduzir no cliente. |
| **PEND-18** | FEAT-04/03 (S6) | Catálogo só existe em pt-BR | `lookupCatalog` devolve `undefined` para outros idiomas de propósito (texto em português para quem pediu inglês seria pior). Em inglês, os achados caem na IA ou ficam com o texto original da ferramenta. Traduzir as 38 entradas devolve o custo zero também para o inglês. |
| **PEND-19** | FEAT-04 (S6) | Idioma vive só no cookie do navegador | Não há `users.locale`: entrar de outra máquina volta ao padrão. Uma coluna + `/api/me` resolveria. |
| **PEND-20** | ARQ-02 | 11 avisos de `react-hooks/set-state-in-effect` | Regra nova do React Compiler sobre o padrão "efeito busca dados e chama setState". Os 11 pontos funcionam e estão verificados em navegador; refatorar todos agora arriscaria regressão sem ganho. Deixada como AVISO, não erro. |
| **PEND-21** | ARQ-01 | Cobertura só dos módulos puros | 59 testes cobrem `lib/` sem banco. `lib/repos/**`, rotas de API e componentes React não têm teste de unidade — dependem de Postgres e de ambiente de render. Um teste de integração com Postgres em container fecharia a maior parte. |
| **PEND-22** | ARQ-03 | Ponta a ponta fora do CI | As 3 suítes de `e2e/` rodam sob demanda: exigem Postgres, build da imagem e rede para o GitHub. Colocá-las no CI traria instabilidade externa para o sinal de build. |
| **PEND-12** | FEAT-01 (S3) | Rota `step3-scan` avulsa não persiste | Só o fluxo completo (`/api/analyze` → `runJob`) grava achados. A rota de scan isolada continua devolvendo o resultado sem criar estado. |

---

# BLOCO 0 · P0 — Destravar o uso

> Sem isto, nada mais importa. Estimativa do bloco: **1 a 2 dias**.

### BUG-01 · A sessão morre em 15 minutos e nada a renova ✅
**P0 · Esforço M**

> ✅ **Corrigido em 27/07/2026.** Renovação automática em `lib/client.ts` (retry único em 401, com deduplicação) + keepalive no `AppShell` a cada 5 min e ao focar a aba. Servidor validado: rotação e revogação do refresh funcionam.

- **Evidência:** [lib/auth.ts:155](lib/auth.ts#L155) (`maxAge: 60 * 15`), [app/api/auth/refresh/route.ts](app/api/auth/refresh/route.ts) existe e é pública ([middleware.ts:16](middleware.ts#L16)), mas `grep` em todo `app/`, `components/` e `lib/` não encontra **nenhuma** chamada a `/api/auth/refresh`.
- **Hoje:** a cada 15 minutos o usuário é expulso para o `/login`, perdendo o estado da tela — inclusive uma análise em andamento. O refresh token de 7 dias nunca é usado.
- **Esperado:** a sessão se renova sozinha e silenciosamente; o usuário só volta ao login quando o refresh de 7 dias expira ou ele sai.
- **Como corrigir:**
  1. Em `lib/client.ts`, no `handle()`: ao receber **401**, chamar `POST /api/auth/refresh` uma única vez (com deduplicação por promise compartilhada, no mesmo padrão do `lib/useMe.ts:16`) e **repetir a requisição original**. Se o refresh também falhar, aí sim redirecionar para `/login`.
  2. Renovação proativa: um timer no `AppShell` que chama o refresh a cada ~12 min enquanto a aba estiver visível (`document.visibilityState === "visible"`).
  3. Guardar o `csrf` devolvido pelo refresh — ele **rotaciona** ([refresh/route.ts:39](app/api/auth/refresh/route.ts#L39)) e o cookie novo já vem na resposta.
- **Cuidado:** o retry precisa de trava anti-loop (se o refresh devolver 401, não tentar de novo) e as chamadas concorrentes devem esperar o mesmo refresh, não disparar N.
- **Aceite:** deixar a tela de resultados aberta por 40 minutos sem tocar; ao voltar, a página continua funcionando sem passar pelo login. `POST /api/auth/refresh` aparece no monitoramento (`token.refresh`).

### BUG-02 · Rate limit de login cobra em dobro e pune login bem-sucedido ✅
**P0 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** Cobrança removida do middleware; a rota consulta a cota sem consumir e **só gasta em falha**, zerando no sucesso. Novo balde por IP puro (`LOGIN_IP_RATE`) contra enumeração. Padrão afrouxado para 10/10m.

- **Evidência:** [middleware.ts:38-40](middleware.ts#L38-L40) cobra o balde `login:<ip>`; [app/api/auth/login/route.ts:24](app/api/auth/login/route.ts#L24) cobra **outro** balde `login:<email>:<ip>`. Ambos usam `LOGIN_RATE` (5/15m, [lib/config.ts:96](lib/config.ts#L96)). [lib/ratelimit.ts:31](lib/ratelimit.ts#L31) incrementa **antes** de checar, e nada decrementa em caso de sucesso.
- **Hoje:** 5 logins **corretos** no mesmo IP bloqueiam o 6º por 15 minutos. Num escritório com NAT (todos no mesmo IP público), o 6º login **da empresa inteira** é bloqueado. O comentário em `login/route.ts:23` diz "por conta + IP", mas o balde do middleware é só por IP — a documentação e o código discordam.
- **Esperado:** o limite protege contra força bruta (tentativas **falhas**), não contra uso normal.
- **Como corrigir:**
  1. **Remover a cobrança do middleware** para `/api/auth/login` (o `API_RATE` global já cobre abuso grosseiro) e deixar o controle na rota, que é a única que conhece o e-mail.
  2. Cobrar **só na falha**: mover o `rateLimit()` para depois do `authenticate()`, ou chamar um `resetRateLimit(key)` no sucesso.
  3. Afrouxar o teto: `LOGIN_RATE=10/10m` por conta+IP é o equilíbrio usual.
  4. Adicionar um balde separado e mais largo por IP puro (ex.: `30/10m`) para o caso de enumeração de contas.
- **Aceite:** 20 logins corretos seguidos passam; 10 senhas erradas seguidas bloqueiam **aquela conta naquele IP** e o `Retry-After` reflete o tempo restante.

### BUG-03 · O limite global de 100/min é consumido pela própria interface ✅
**P0 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** `/api/status/*` isento do balde global (`isRateExempt`) e polling com backoff 1,5s → 3s → 6s, pausado com a aba oculta.

- **Evidência:** [app/results/[id]/page.tsx:102](app/results/[id]/page.tsx#L102) faz polling a cada **1.400 ms** ⇒ ~43 req/min por aba; `API_RATE=100/1m` por IP ([lib/config.ts:101](lib/config.ts#L101)).
- **Hoje:** duas abas de resultados abertas (86 req/min) + qualquer navegação = 429 na API inteira, inclusive no polling, que então morre (ver `BUG-04`).
- **Esperado:** o custo da interface não pode consumir o orçamento anti-abuso.
- **Como corrigir:**
  1. Polling com **backoff progressivo**: 1,5 s nos primeiros 15 s, depois 3 s, depois 6 s (teto). Uma análise leva minutos — polling de 1,4 s o tempo todo é desperdício puro.
  2. Pausar quando `document.visibilityState !== "visible"` e retomar ao voltar.
  3. Isentar `GET /api/status/*` do balde global ou dar a ele um balde próprio bem mais largo.
  4. Melhor ainda (`ARQ-05`): trocar polling por SSE.
- **Aceite:** tela de resultados aberta por 10 minutos em 3 abas sem nenhum 429.

### BUG-04 · O polling para para sempre no primeiro erro ✅
**P0 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** Novo hook `lib/useAnalysisPolling.ts`: reagenda com backoff exponencial (2s→30s), só mostra erro após 4 falhas seguidas e expõe `retry()`. Erro vira aviso quando a análise já carregou uma vez.

- **Evidência:** [app/results/[id]/page.tsx:97-107](app/results/[id]/page.tsx#L97-L107) — o `catch` chama `setError()` e **não reagenda** o `setTimeout`.
- **Hoje:** um único 429, uma oscilação de rede ou um 500 transitório congela a tela num estado de erro permanente. O usuário acha que a análise morreu; ela está rodando normalmente no servidor.
- **Esperado:** erro transitório se recupera sozinho.
- **Como corrigir:** reagendar no `catch` com backoff exponencial (2 s → 4 s → 8 s, teto 30 s), contar falhas consecutivas e só mostrar o erro terminal depois de ~5 seguidas — com botão "Tentar novamente". Tratar 401 chamando o refresh (`BUG-01`) e 429 respeitando o `Retry-After`.
- **Aceite:** derrubar a rede por 20 s durante uma análise; ao voltar, a tela retoma o progresso sozinha.

### BUG-05 · Busca dispara uma requisição por tecla, em três telas ✅
**P0 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** Hook `lib/useDebounced.ts` (350 ms) + `AbortController` cancelando a requisição anterior, nas três telas de listagem.

- **Evidência:** [app/analyses/page.tsx:47-66](app/analyses/page.tsx#L47-L66) (`load` no `useCallback` com `q` na dependência + `useEffect([load])`), replicado em [app/admin/users/page.tsx:40-56](app/admin/users/page.tsx#L40-L56) e [app/admin/monitoring/page.tsx:70-90](app/admin/monitoring/page.tsx#L70-L90).
- **Hoje:** digitar "starguard" = **9 requisições** com `COUNT(*)` + `ILIKE '%...%'` no banco. Sem cancelamento, respostas fora de ordem podem sobrescrever o resultado certo com um antigo.
- **Esperado:** uma requisição por pausa de digitação.
- **Como corrigir:** `useDebouncedValue(q, 350)` (hook novo em `lib/`) alimentando o `load`; passar `AbortController` para o `apiGet` e abortar a requisição anterior a cada nova. Aproveitar para dar o mesmo tratamento aos filtros de data.
- **Aceite:** digitar 10 caracteres rápido gera **1** requisição; digitar e apagar rápido nunca deixa a lista num resultado velho.

### BUG-06 · Duas correções no mesmo arquivo: a última apaga a primeira, em silêncio ✅
**P0 · Esforço M**

> ✅ **Corrigido em 27/07/2026.** O `BatchFixModal` agrupa os achados por arquivo e envia **uma** correção por arquivo, com todos os problemas no mesmo prompt (`alsoFix` no `step4Schema`). O PR passa a ter uma entrada por arquivo — nada mais se sobrescreve.

- **Evidência:** [components/BatchFixModal.tsx:140-146](components/BatchFixModal.tsx#L140-L146) monta `files[]` com um item por achado; [lib/github.ts:242-249](lib/github.ts#L242-L249) deduplica por caminho — *"Arquivos repetidos são deduplicados (o último conteúdo prevalece)"*.
- **Hoje:** cada correção é gerada **independentemente a partir do arquivo original**. Se dois achados estão no mesmo arquivo (o caso comum — meu scan de teste no próprio StarGuard achou 576 achados concentrados em poucos arquivos), a segunda correção não contém a primeira. O PR recebe só a segunda, e a primeira vulnerabilidade **continua aberta enquanto a UI diz que foi corrigida**. Perda de dado silenciosa, num produto de segurança.
- **Esperado:** correções no mesmo arquivo se acumulam, ou o usuário é avisado explicitamente.
- **Como corrigir (em ordem de robustez):**
  1. **Curto prazo (1h):** agrupar por arquivo antes de gerar; se um arquivo tem N>1 achados selecionados, gerar **uma única** correção passando os N contextos no mesmo prompt. É o caminho mais simples e o resultado é melhor (a IA vê os problemas juntos).
  2. **Sequencial:** para o mesmo arquivo, gerar em série alimentando o `fixedCode` anterior como entrada da próxima.
  3. **Rede de proteção:** em `openPullRequestBatch`, detectar caminho repetido e **falhar com erro claro** em vez de descartar em silêncio.
- **Aceite:** selecionar 3 achados do mesmo arquivo → o PR contém as 3 correções; o teste de regressão verifica que o conteúdo final contém marcas das 3.

### BUG-07 · Correção multi-arquivo do agente perde arquivos no PR ✅
**P0 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** Quando o agente altera mais de um arquivo, o PR individual passa a usar a rota `pr-batch` com todos eles; o modal lista os arquivos afetados antes de abrir.

- **Evidência:** [types/index.ts:144](types/index.ts#L144) define `changedFiles[]`; [lib/agent-fix.ts:145-150](lib/agent-fix.ts#L145-L150) preenche corretamente; mas [app/results/[id]/page.tsx:159-166](app/results/[id]/page.tsx#L159-L166) envia só `file` + `fixedCode`.
- **Hoje:** o agente (`FIX_ENGINE=agent`, que é o **padrão**) pode alterar 4 arquivos; o PR commita 1. O resultado é um PR que não compila — pior que não ter PR.
- **Esperado:** o PR contém tudo que o agente mudou.
- **Como corrigir:** quando `fix.changedFiles?.length > 1`, usar a rota `/api/github/pr-batch` (que já existe e aceita `files[]`) em vez da `/api/github/pr`. Mostrar no modal a lista de arquivos afetados antes de abrir o PR.
- **Aceite:** uma correção do agente que toque 3 arquivos gera um PR com 3 arquivos alterados.

### BUG-08 · Contador de Pull Requests é sempre zero ✅
**P0 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** `createPR` incrementa `analyses.prs_count`, e o `computeMetrics` deixou de recalcular (e zerar) esse contador no fim do job.

- **Evidência:** [lib/jobs.ts:255](lib/jobs.ts#L255) retorna `{ fixes, prs: [] }` e nada nunca adiciona a `prs`; [lib/jobs.ts:182](lib/jobs.ts#L182) calcula `prsCount: refactor?.prs.length ?? 0` **uma única vez**, no fim do job — antes de qualquer PR existir. A rota de PR grava na tabela `pull_requests` ([pr/route.ts:46-56](app/api/github/pr/route.ts#L46-L56)) mas não toca na análise.
- **Hoje:** a coluna "PRs" na lista de análises, na tabela de usuários do admin e no relatório mostra **0 para sempre**, mesmo com PRs abertos. A tela `/pull-requests` (que lê a tabela) mostra os PRs corretamente — as duas telas se contradizem.
- **Esperado:** o contador reflete os PRs abertos.
- **Como corrigir:** ao gravar em `pull_requests`, incrementar `analyses.prs_count` na mesma transação (`sql\`prs_count + 1\``) quando houver `analysisId`. Alternativa mais limpa: derivar `prsCount` de um `COUNT` na listagem, e apagar a coluna desnormalizada.
- **Aceite:** abrir um PR e ver o contador virar 1 na lista de análises sem reprocessar nada.

---

# BLOCO 1 · P0/P1 — Segurança

> A ferramenta é de segurança; um furo aqui custa credibilidade. Estimativa: **1 a 2 dias**.

### SEC-01 · Token do GitHub pode vazar para o banco e para a tela ✅
**P0 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** Novo `lib/redact.ts` aplicado no clone, no `runPhase` (antes de persistir) e nas rotas de github/scan. O clone também limpa a credencial do `.git/config` via `git remote set-url`.

- **Evidência:** [lib/github.ts:36](lib/github.ts#L36) monta `https://x-access-token:<TOKEN>@github.com/...`; [lib/github.ts:61](lib/github.ts#L61) devolve `Falha ao clonar o repositório: ${msg.slice(0, 200)}` — e a mensagem de erro do `git` **inclui a URL completa** (`fatal: Authentication failed for 'https://x-access-token:ghp_xxx@github.com/o/r.git/'`). Esse texto vira `ph.error` ([lib/jobs.ts:205](lib/jobs.ts#L205)), é **persistido no JSONB `phases`** e exibido na tela ([results/[id]/page.tsx:304](app/results/[id]/page.tsx#L304)).
- **Hoje:** um token com senha errada, expirado ou sem permissão grava o PAT em texto puro no Postgres e mostra na interface. Contradiz frontalmente o `README` ("Token do GitHub vive **só em memória** durante o job").
- **Como corrigir:**
  1. Sanitizar toda mensagem de erro do git: `msg.replace(/https:\/\/[^@\s]+@/g, "https://***@")` antes de propagar — e aplicar o mesmo filtro em `lib/agent-fix.ts`.
  2. Melhor: não pôr o token na URL. Usar `git -c http.extraHeader="Authorization: Basic <base64>"`, que não aparece em mensagens de erro.
  3. Varrer a base atual: `select id from starguard.analyses where phases::text like '%x-access-token%'`.
- **Aceite:** clonar um repo privado com token inválido → a mensagem na tela e no banco mostra `https://***@github.com/...`.

### SEC-02 · Papel alterado e usuário excluído continuam com sessão válida por 7 dias ✅
**P0 · Esforço M**

> ✅ **Corrigido em 27/07/2026.** Coluna `sessions_invalidated_at` (migração `0002`): o refresh lê o usuário do **banco** (papel atual, conta ativa) e recusa token emitido antes do corte. Troca de papel e exclusão gravam o corte na mesma instrução. `requireRole` reconfere o papel no banco.

- **Evidência:** [app/api/auth/refresh/route.ts:33-38](app/api/auth/refresh/route.ts#L33-L38) reconstrói o usuário **a partir das claims do token**, sem consultar o banco. [admin/users/[id]/route.ts DELETE](app/api/admin/users/[id]/route.ts) faz soft delete e **não revoga** nada; o PATCH de papel também não.
- **Hoje:** rebaixar um superadmin para admin não tem efeito — o refresh continua emitindo access tokens com `role: "superadmin"` por até 7 dias. Excluir um usuário idem: ele continua entrando. É uma falha de controle de acesso (OWASP A01).
- **Como corrigir:**
  1. No refresh, buscar o usuário no banco: se `deletedAt` não for nulo → 401; usar o **papel atual do banco**, não o da claim.
  2. Ao excluir ou trocar papel, gravar um `sessions_invalidated_at` no usuário e rejeitar refresh cujo `iat` seja anterior a essa marca (revogação em massa sem precisar listar jtis).
  3. Auditar o evento como `session.revoked`.
- **Aceite:** rebaixar um superadmin com a sessão aberta → na próxima renovação ele perde o menu de Governança e `/api/admin/*` devolve 403.

### SEC-03 · Trocar a senha não invalida sessões antigas ✅
**P1 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** Troca de senha/e-mail derruba as demais sessões (corte + revogação do refresh atual) e registra `session.revoked` na auditoria.

- **Evidência:** [app/api/account/profile/route.ts:99-107](app/api/account/profile/route.ts#L99-L107) emite uma sessão nova, mas nunca chama `revokeRefresh` do refresh anterior.
- **Hoje:** quem trocou a senha porque desconfiou de invasão **continua invadido** — o refresh token roubado vale 7 dias.
- **Como corrigir:** revogar o `jti` do refresh atual e aplicar o `sessions_invalidated_at` do `SEC-02`. Oferecer "encerrar sessões em todos os dispositivos".
- **Aceite:** com duas sessões abertas, trocar a senha em uma derruba a outra na renovação seguinte.

### SEC-04 · Rate limit contornável e envenenável via X-Forwarded-For ✅
**P1 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** `clientIp()` passa a contar a partir da direita, com `TRUSTED_PROXY_HOPS` (padrão 1).

- **Evidência:** [lib/ratelimit.ts:43-44](lib/ratelimit.ts#L43-L44) — `xff.split(",")[0]` pega a entrada **mais à esquerda**, que é fornecida pelo cliente.
- **Hoje:** um atacante manda `X-Forwarded-For: 1.2.3.4` diferente a cada tentativa e **ignora o rate limit de login**. Pior: mandando o IP de outra pessoa, ele enche o balde dela e a **tranca fora do sistema** (negação de serviço direcionada).
- **Como corrigir:** no Render, o proxy **acrescenta** o IP real à direita. Ler a entrada mais à direita, ou melhor: um `TRUSTED_PROXY_HOPS=1` por env e pegar `xff[len - hops]`. Nunca confiar no `[0]`.
- **Aceite:** repetir logins variando o `X-Forwarded-For` continua batendo no mesmo balde.

### SEC-05 · IP em texto puro gravado num campo chamado "ipHash" ✅
**P1 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** IP nunca mais vai em claro: `hashIp()` = sha256 com sal do servidor, e o `meta` do rate limit passou a gravar `{scope}` em vez do IP.

- **Evidência:** [app/api/auth/login/route.ts:26](app/api/auth/login/route.ts#L26) — `audit("login.ratelimited", { ipHash: ip })` passa o IP **cru** dentro do `meta`. É exibido na coluna "Detalhe" do monitoramento ([admin/monitoring/page.tsx:180](app/admin/monitoring/page.tsx#L180)).
- **Hoje:** dado pessoal (LGPD) armazenado em claro sob um nome que afirma o contrário; o `README` promete "auditoria sem dados sensíveis".
- **Como corrigir:** `sha256(ip + AUDIT_IP_SALT)` truncado em 12 caracteres, passado no **4º parâmetro** de `audit()` (a coluna `ip_hash` existe e nunca é usada — ver `BUG-09`), nunca no `meta`.
- **Aceite:** nenhum registro em `audit_log` contém um IP legível.

### SEC-06 · `GITHUB_TOKEN` do servidor usado em nome de qualquer usuário ✅
**P1 · Esforço P**

- **Evidência:** [lib/github.ts:86](lib/github.ts#L86), [:108](lib/github.ts#L108), [:136](lib/github.ts#L136) — `token || process.env.GITHUB_TOKEN`.
- **Hoje:** num deploy multi-usuário, quem não tem token usa o do servidor e pode ler (e abrir PR em) qualquer repositório privado ao qual o token do servidor tenha acesso, bastando saber a URL.
- **Como corrigir:** usar o fallback global **apenas** quando `SINGLE_TENANT=true` estiver explícito; caso contrário exigir o token do usuário e responder com uma mensagem clara.
- **Aceite:** usuário sem token em repo privado recebe "informe um token do GitHub", não os dados do repositório.

### SEC-07 · CSRF aplicado de forma inconsistente ✅
**P2 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** `requireCsrf` adicionado em `step1-threat` e `step2-skills`; logout do `AppShell` passou a usar `apiPost`. Só as 3 rotas de auth ficam sem CSRF — por desenho.

- **Evidência:** `requireCsrf` está em 10 rotas, mas **falta** em [step1-threat](app/api/step1-threat/route.ts) e [step2-skills](app/api/step2-skills/route.ts) (POST que gastam IA) e em [logout](app/api/auth/logout/route.ts). O `AppShell` faz logout com `fetch` cru sem o header ([AppShell.tsx:87](components/AppShell.tsx#L87)) — se alguém padronizar o CSRF, o logout quebra.
- **Hoje:** risco baixo na prática (cookies `SameSite=Strict`), mas é uma inconsistência que vira furo na primeira mudança de configuração de cookie.
- **Como corrigir:** aplicar `requireCsrf` em **todo** método não-GET; trocar o `fetch` do logout por `apiPost`. Melhor: centralizar no middleware ("todo método mutante exige CSRF") e remover a checagem espalhada.
- **Aceite:** um teste que percorre todas as rotas e falha se um handler POST/PATCH/DELETE não exigir CSRF.

### SEC-08 · Rate limit em memória não sobrevive a múltiplas instâncias e vaza memória ✅
**P2 · Esforço M**

> ✅ **Corrigido em 27/07/2026.** **Parcial:** varredura de baldes expirados eliminou o vazamento de memória. O backend Redis continua pendente.

- **Evidência:** [lib/ratelimit.ts:13-14](lib/ratelimit.ts#L13-L14) — `Map` em `globalThis`, sem expurgo. `RATE_LIMIT_REDIS_URL` está no `.env.example` mas **não é lido em lugar nenhum**.
- **Hoje:** com 2 instâncias no Render, o limite efetivo dobra e fica imprevisível; o `Map` cresce sem limite (uma entrada por IP, para sempre).
- **Como corrigir:** implementar o backend Redis mantendo a assinatura atual; enquanto isso, varrer entradas expiradas a cada N chamadas e limitar o tamanho do Map.
- **Aceite:** com 2 instâncias, o 11º login falho é bloqueado independentemente de qual instância atendeu.

### SEC-09 · Sem cabeçalho de segurança para o conteúdo gerado pela IA 💡
**P2 · Esforço P**

- **Hoje:** `description`, `explanation` e `fixedCode` vêm da IA e são renderizados como texto no React (escapado por padrão ✅). O risco real não é XSS, é **prompt injection vindo do repositório analisado** influenciando o texto mostrado ao usuário como se fosse veredito da ferramenta.
- **Como corrigir:** marcar visualmente na UI o que é "texto gerado a partir do repositório analisado" e truncar em tamanho máximo. O agente já está protegido (`settingSources: []`), a revisão por IA não tem essa proteção explícita.
- **Aceite:** um repositório com `<!-- ignore previous instructions -->` em um comentário não altera a apresentação dos achados.

---

# BLOCO 2 · P1 — As quatro funcionalidades que você pediu

> Estimativa do bloco: **6 a 9 dias**. `FEAT-01` é pré-requisito de `FEAT-02`.

### FEAT-01 · Estado por achado: corrigido, PR aberto, falso positivo 💡
**P1 · Esforço G** — *pedido explícito*

> ✅ **Entregue em 27/07/2026.** Tabela `findings` (migração `0003`) com impressão digital estável em `lib/fingerprint.ts` (regra + arquivo + trecho normalizado, **sem** a linha). `runJob` persiste os achados e **herda** o estado resolvido de análises anteriores do mesmo repositório. Rotas `GET /api/analyses/:id/findings` e `PATCH /api/findings/:id`; na tela, filtro Abertos/Resolvidos, selo de estado e ações "Já corrigi"/"Falso positivo". Abrir PR marca `pr_open`.

**O bloqueio real:** hoje **não existe entidade "achado"** no banco. Tudo vive dentro do
JSONB `analyses.phases` ([db/schema.ts:97](db/schema.ts#L97)), e os ids são **posicionais**:
`V-1`, `V-2` ([lib/parsers.ts:69](lib/parsers.ts#L69)), `D-1` ([:106](lib/parsers.ts#L106)),
`AI-1` ([lib/review.ts:234](lib/review.ts#L234)). No re-scan, `V-3` pode ser uma
vulnerabilidade **completamente diferente** — marcar por id corromperia o histórico.
Existe até um campo `falsePositive` em [types/index.ts:82](types/index.ts#L82) que **nunca
foi usado**.

**Passo 1 — impressão digital estável (pré-requisito):**
```ts
// lib/fingerprint.ts
fingerprint = sha256([
  ruleId,                       // regra que disparou
  normalizePath(file),          // caminho relativo normalizado
  normalizeSnippet(codeSnippet) // sem espaços/indentação, minúsculo
].join("|")).slice(0, 32);
```
Deliberadamente **sem o número da linha**: código deslocado por edições acima não pode
ressuscitar um achado já corrigido. Para SCA, a impressão é `cve + package`.

**Passo 2 — tabelas novas:**
```sql
create type starguard.finding_status as enum
  ('open','fixed','pr_open','pr_merged','false_positive','accepted_risk');

create table starguard.findings (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid not null references starguard.analyses(id),
  user_id       uuid not null references starguard.users(id),
  fingerprint   text not null,
  source        text not null,              -- sast | sca | ai-review
  rule_id       text not null,
  severity      text not null,
  file          text,
  line          integer,
  title         text not null,
  payload       jsonb not null,             -- o Vulnerability/DependencyVuln completo
  status        starguard.finding_status not null default 'open',
  status_note   text,
  status_by     uuid references starguard.users(id),
  status_at     timestamptz,
  pull_request_id uuid references starguard.pull_requests(id),
  created_at    timestamptz not null default now()
);
create index findings_analysis_idx on starguard.findings(analysis_id, severity);
create index findings_fp_idx       on starguard.findings(user_id, fingerprint);
```

**Passo 3 — herança entre análises:** ao criar os achados de um scan novo, consultar
`findings` do mesmo `user_id` + `repo_url` pela `fingerprint`; se o estado anterior for
`fixed`/`false_positive`/`accepted_risk`, **herdar** e marcar `inherited_from`. É isso que
transforma o StarGuard de "relatório" em "ferramenta de acompanhamento".

**Passo 4 — API e UI:**
- `PATCH /api/findings/:id` com `{ status, note }` (CSRF + dono/superadmin).
- Ao abrir PR, marcar automaticamente `pr_open` e gravar `pull_request_id`.
- Na tela de resultados: filtro por estado (`UX-01`), ação "marcar como corrigido / falso positivo" em cada card, contagem "12 abertos · 3 corrigidos · 2 falsos positivos".
- Achado resolvido **some da lista por padrão**, com um toggle "mostrar resolvidos".

**Aceite:** marcar um achado como falso positivo → rodar o scan de novo no mesmo repo → ele volta já marcado, fora da lista padrão, e o contador de abertos não o inclui.

### FEAT-02 · Preservar a correção gerada (parar de queimar tokens) 💡
**P1 · Esforço M** — *pedido explícito*

> ✅ **Entregue em 27/07/2026.** Tabela `finding_fixes` guarda cada correção (com histórico: refazer aposenta a anterior em vez de apagar). `POST /api/step4-fix` devolve a correção guardada com `cached: true` e **só chama a IA** quando não há nada guardado ou quando vem `force: true` — o botão "Refazer". Reabrir o modal deixou de custar tokens.

- **Evidência:** [app/results/[id]/page.tsx:117-123](app/results/[id]/page.tsx#L117-L123) — `openFix` faz `setFix(null)` **toda vez** que o modal abre; [:696](app/results/[id]/page.tsx#L696) remonta o componente via `key`. Nada é persistido: `generateFix` ([lib/tasks.ts:188](lib/tasks.ts#L188)) devolve e o resultado morre no estado do React.
- **Hoje:** gerar → fechar → reabrir = **nova chamada de IA**, novo custo, nova espera. Com `FIX_ENGINE=agent` (padrão), cada regeneração clona o repositório e roda o agente por até 4,5 minutos — o desperdício é de dinheiro *e* de tempo.
- **Solução em duas camadas:**
  1. **Cache de sessão (1h de trabalho):** trocar `fix` por `Map<vulnId, FixResult>` no estado; `openFix` lê o cache; o botão do modal já diz "Refazer com estas instruções" quando existe correção ([FixModal.tsx:118](components/FixModal.tsx#L118)) — passa a ser a única forma de gastar IA de novo.
  2. **Persistência (o que realmente resolve):** tabela nova, ligada ao achado do `FEAT-01`:
```sql
create table starguard.finding_fixes (
  id           uuid primary key default gen_random_uuid(),
  finding_id   uuid not null references starguard.findings(id),
  engine       text not null,        -- agent | api
  model        text,
  instructions text,                 -- o prompt personalizado usado
  original_code text not null,
  fixed_code   text not null,
  changed_files jsonb,               -- multi-arquivo do agente
  explanation  text,
  cost_usd     numeric(10,4),        -- ver ARQ-08
  created_by   uuid references starguard.users(id),
  created_at   timestamptz not null default now(),
  superseded_at timestamptz          -- preenchido quando o usuário refaz
);
```
  - `GET /api/findings/:id/fix` devolve a última correção não substituída.
  - `POST` só gera se não houver, **ou** se vier `force: true` (o "Refazer").
  - Guardar as versões antigas (não apagar): permite comparar tentativas.
- **Ganho extra:** a correção sobrevive a recarregar a página, trocar de máquina e é visível para o superadmin.
- **Aceite:** gerar uma correção, dar F5, reabrir o modal → a correção aparece instantaneamente, sem chamada de IA (confirmável no `audit_log`: nenhum `fix.generate` novo).

### FEAT-03 · Descrever as vulnerabilidades de verdade 💡
**P1 · Esforço M** — *pedido explícito*

> ✅ **Entregue em 27/07/2026.** `lib/catalog.ts` (38 entradas: 24 regras + 14 CWEs) explica os achados mais comuns **sem custo e offline**; `lib/enrich.ts` chama a IA **em lote** só para as regras que sobram, e sem chave mantém o texto original marcado como "texto da ferramenta". O card passa a mostrar título traduzido, o que é, por que importa e como corrigir — com cenário de ataque, trecho e texto original num `Collapsible`.

- **Evidência:** [lib/parsers.ts:72-77](lib/parsers.ts#L72-L77) — `title` e `description` são o `extra.message` cru do Opengrep, **em inglês**, frequentemente uma frase técnica seca. O `suggestion` do SAST é uma **string fixa** ([:79-80](lib/parsers.ts#L79-L80)), igual para todos os achados. Resultado: interface em português com achados em inglês e uma "sugestão" que não sugere nada.
- **Esperado:** cada achado explica, no idioma do usuário: **o que é**, **por que é perigoso neste código**, **como um atacante exploraria** e **como corrigir**.
- **Como corrigir:**
  1. **Camada de enriquecimento** (`lib/enrich.ts`), rodando ao fim da Fase 3, **em lote** (todos os achados numa chamada só, agrupados por regra — barato): recebe regra + CWE + trecho + caminho e devolve `{ title, whatItIs, whyItMatters, attackScenario, howToFix }` no idioma alvo.
  2. **Persistir o enriquecimento** junto do achado (`findings.payload`) — nunca reprocessar.
  3. **Catálogo estático** para as ~50 regras mais comuns (CWE-89, CWE-79, CWE-78…) em `lib/catalog/<locale>.json`: acerto instantâneo, custo zero, e a IA só entra no que não está no catálogo.
  4. **Fallback honesto:** sem chave de IA, mostrar o texto original do scanner marcado como "descrição original da ferramenta (em inglês)" — nunca uma tradução inventada.
- **UI:** o card mostra `whatItIs` + `whyItMatters`; `attackScenario` e o trecho ficam num `Collapsible` (segue a direção de UX enxuta já adotada no projeto).
- **Aceite:** um achado `detect-child-process` exibe "Execução de comando do sistema com entrada não validada — um atacante que controle `userInput` executa comandos arbitrários no servidor", em português, e em inglês quando o idioma for `en`.

### FEAT-04 · Internacionalização de verdade (UI + IA) 💡
**P1 · Esforço G** — *pedido explícito*

> 🟡 **Parcial — 27/07/2026.** **Fundação entregue e testada** (detecção automática por `Accept-Language`, cookie, `<html lang>` dinâmico, provider com `t()` e fallback, seletor na Conta) e a **saída da IA** já respeita o idioma nas quatro frentes de geração — a análise carrega a escolha até o fim do job. A extração de strings cobre o fluxo principal (login → menu → resultados → correção); governança, relatório e onboarding seguem em português — ver PEND-16.

- **Evidência:** zero infraestrutura de i18n (nenhum `next-intl`/`react-i18next`, nenhuma pasta `locales/`). [app/layout.tsx:40](app/layout.tsx#L40) fixa `lang="pt-BR"`. Todas as strings estão embutidas no JSX. Os **prompts** também são pt-BR e um deles ordena explicitamente `Output em PT-BR` ([lib/review.ts:38](lib/review.ts#L38)).
- **O ponto que costuma ser esquecido:** traduzir a interface não basta. Se a IA continuar respondendo em português, o usuário em inglês vê botões traduzidos e **conteúdo** em português. i18n aqui tem **quatro** frentes:

| Frente | Onde | Como |
|---|---|---|
| Interface | ~40 arquivos `.tsx` | `next-intl` + `messages/{pt-BR,en,es}.json` |
| Enums de domínio | `SEVERITY_LABEL_PT` ([types/index.ts:205](types/index.ts#L205)) | virar chave de tradução, não string |
| Saída da IA | `lib/tasks.ts`, `lib/review.ts`, `lib/skills.ts` | parâmetro `locale` no prompt: *"Responda em {locale}"* |
| Formatação | [listing.tsx:11](components/listing.tsx#L11) fixa `toLocaleString("pt-BR")` | receber o locale ativo |

- **Plano:**
  1. `next-intl` com roteamento por prefixo (`/pt-BR/...`, `/en/...`) **ou** cookie `NEXT_LOCALE` (mais simples, não quebra as URLs existentes — recomendo este).
  2. Coluna `users.locale` (default `pt-BR`) + seletor na tela de Conta; `<html lang>` dinâmico.
  3. Extrair as strings em ondas: primeiro `AppShell`/login/erros da API, depois telas.
  4. **Mensagens de erro da API também** — hoje `jsonError(401, "Não autenticado.")` é pt-BR fixo. Passar a devolver uma **chave** (`error.unauthenticated`) e traduzir no cliente; manter um `message` em inglês como fallback de log.
  5. Guardar o `locale` na análise: um relatório gerado em português continua em português para quem abrir depois.
- **Aceite:** trocar o idioma para `en` → menu, cards, mensagens de erro, descrições de vulnerabilidade e explicações de correção saem todos em inglês; o PDF exportado idem.

---

# BLOCO 3 · P2 — UX e interface

### UX-01 · A tela de resultados não tem nenhum filtro ✅
**P2 · Esforço M**

> ✅ **Entregue em 27/07/2026.** Barra de filtros na aba Correções (busca por arquivo/regra/CWE, severidade, origem) reaproveitando `components/filters.tsx`, somada ao filtro de estado do FEAT-01. A lista passou a renderizar 25 cards por vez com "Mostrar mais" — 44 de uma vez já pesavam na tela.

- **Evidência:** [app/results/[id]/page.tsx:541-552](app/results/[id]/page.tsx#L541-L552) renderiza **todos** os achados de uma vez. O projeto **já tem** componentes de filtro prontos e bons ([components/filters.tsx](components/filters.tsx): busca, segmentado, faixa de datas, com ESC e clique-fora) — usados apenas nas listagens.
- **Hoje:** meu scan de teste no próprio repositório gerou **576 achados**. A tela renderiza 576 cards com `<pre>` de código. É inutilizável e trava o navegador.
- **Como corrigir:** barra de filtros reaproveitando `filters.tsx` — severidade (segmentado), origem (SAST/IA/SCA), estado (`FEAT-01`), busca por arquivo/regra; ordenação (severidade, arquivo, regra); **agrupar por arquivo** com colapso; e paginação ou virtualização a partir de ~50 itens.
- **Aceite:** 500 achados carregam em menos de 1 s e é possível chegar aos críticos de um arquivo em dois cliques.

### UX-02 · "Ver diff" não mostra diff ✅
**P2 · Esforço M**

> ✅ **Entregue em 27/07/2026.** `lib/diff.ts` (LCS com corte de prefixo/sufixo) + `components/CodeDiff.tsx`: marcação verde/vermelha, numeração dos dois lados, regiões inalteradas colapsadas e alternância diff/arquivo completo. Uma correção de 2 linhas num arquivo de 200 mostra **9 linhas**.

- **Evidência:** [FixModal.tsx:146-151](components/FixModal.tsx#L146-L151) mostra o arquivo corrigido inteiro num `<pre>`; [BatchFixModal.tsx:248-258](components/BatchFixModal.tsx#L248-L258) mostra original e corrigido em dois blocos sob o rótulo "ver diff".
- **Hoje:** para revisar uma correção num arquivo de 400 linhas, o usuário lê 400 linhas e adivinha o que mudou. É o pior ponto de fricção do fluxo principal do produto.
- **Como corrigir:** diff real por linhas (algoritmo de Myers; `diff` ou implementação própria de ~80 linhas), com marcação verde/vermelha, contexto de 3 linhas e as regiões inalteradas colapsadas ("… 120 linhas inalteradas"). Alternar entre "diff" e "arquivo completo".
- **Aceite:** uma correção de 2 linhas num arquivo de 400 exibe ~8 linhas na tela.

### UX-03 · Clicar fora do modal joga fora a correção gerada ✅
**P2 · Esforço P**

- **Evidência:** [FixModal.tsx:57](components/FixModal.tsx#L57) e [BatchFixModal.tsx:178](components/BatchFixModal.tsx#L178) — `onClick={onClose}` no overlay.
- **Hoje:** um clique acidental fora do modal descarta uma correção que custou minutos e dinheiro (agrava-se com a falta de cache do `FEAT-02`).
- **Como corrigir:** com o `FEAT-02` o dano some (a correção fica salva). Ainda assim: confirmar antes de fechar se houver conteúdo não aproveitado, e nunca fechar por clique no overlay durante a geração.
- **Aceite:** clicar fora com uma correção gerada pede confirmação.

### UX-04 · Modais sem acessibilidade ✅
**P2 · Esforço P**

> ✅ **Entregue em 27/07/2026.** `components/Modal.tsx` compartilhado: `role=dialog`, `aria-modal`, `aria-labelledby`, foco inicial, armadilha de Tab, ESC, trava de rolagem do fundo e devolução do foco ao fechar. `FixModal` e `BatchFixModal` migrados.

- **Evidência:** `FixModal`, `BatchFixModal` e `NewUserModal` não têm `role="dialog"`, `aria-modal`, foco inicial, armadilha de foco, retorno do foco ao fechar, fechamento por **ESC** nem trava de rolagem do fundo. Ironia: o `useDropdown` de [filters.tsx:18-35](components/filters.tsx#L18-L35) faz tudo isso certo.
- **Como corrigir:** um `<Modal>` compartilhado com `role="dialog" aria-modal="true" aria-labelledby`, foco no primeiro elemento ao abrir, ciclo de Tab preso, ESC fecha, `overflow: hidden` no `body`, foco devolvido ao gatilho.
- **Aceite:** navegação inteira por teclado; ESC fecha; leitor de tela anuncia o título do modal.

### UX-05 · Lote começa a gastar IA sem perguntar e não dá para cancelar ✅
**P2 · Esforço P**

> ✅ **Entregue em 27/07/2026.** O lote ganhou tela de confirmação com o custo (N achados em M arquivos = M chamadas de IA) e botão de cancelar durante a geração, via `AbortController`. Nada dispara sozinho ao abrir o modal.

- **Evidência:** [BatchFixModal.tsx:78-121](components/BatchFixModal.tsx#L78-L121) — o `useEffect` dispara na montagem, 3 em paralelo. Fechar o modal só marca `cancelled = true`: as requisições em voo **terminam no servidor** e o resultado é jogado fora.
- **Hoje:** selecionar 50 achados e clicar = 50 chamadas de IA imediatas, sem aviso de custo e sem freio. Com `FIX_ENGINE=agent`, são 50 clones de repositório.
- **Como corrigir:** tela de confirmação antes ("50 correções · estimativa ~US$ X · ~Y min") com botão "Começar"; botão "Cancelar" que aborta via `AbortController` (o servidor precisa honrar o `signal`); persistir o que já ficou pronto (`FEAT-02`).
- **Aceite:** dá para cancelar no meio e o que já foi gerado permanece salvo.

### UX-06 · A revisão por IA lê ~40 arquivos e não avisa ✅
**P2 · Esforço P**

> ✅ **Entregue em 27/07/2026.** `runAiReview` devolve `coverage` (arquivos lidos / elegíveis / truncados) e a tela informa quanto do repositório a revisão realmente leu, deixando explícito que SAST e SCA analisaram tudo.

- **Evidência:** [lib/review.ts:104-106](lib/review.ts#L104-L106) — teto de 40 arquivos / 180 KB / 24 KB por arquivo. O total descoberto (`discovered`) vai só para dentro do prompt ([:288](lib/review.ts#L288)) e **não** para o resultado.
- **Hoje:** num repositório de 800 arquivos, a revisão vê 5% e a interface apresenta o resultado como se fosse a análise do projeto inteiro. Numa ferramenta de segurança isso é um problema de honestidade, não de UX.
- **Como corrigir:** devolver `coverage: { filesReviewed, filesEligible, bytesUsed, truncatedFiles }` na seção `review` e mostrar: *"Revisão por IA cobriu 40 de 812 arquivos elegíveis (priorizando autenticação, rotas e banco)"*. Oferecer "revisar mais arquivos" com orçamento maior.
- **Aceite:** a tela informa a cobertura sempre que a revisão rodar.

### UX-07 · Achado da IA não mostra o nível de confiança ✅
**P2 · Esforço P**

- **Evidência:** `confidence: "high" | "medium"` é preenchido ([lib/review.ts:251](lib/review.ts#L251)) e nunca exibido — `grep` por `confidence` nos `.tsx` não retorna nada.
- **Como corrigir:** badge "confiança média" no `VulnerabilityCard` e filtro por confiança.
- **Aceite:** dá para esconder achados de confiança média com um clique.

### UX-08 · Não há link do achado para o código no GitHub 💡
**P2 · Esforço P**

- **Hoje:** o card mostra `file` e `line` como texto ([VulnerabilityCard.tsx:52-59](components/VulnerabilityCard.tsx#L52-L59)). Para ver o contexto real, o usuário abre o GitHub e navega à mão.
- **Como corrigir:** `{repoUrl}/blob/{defaultBranch}/{file}#L{line}-L{endLine}` — o `defaultBranch` já é buscado em `getRepoMeta`.
- **Aceite:** um clique abre a linha exata no GitHub.

### UX-09 · Instrução padrão duplicada nos achados da IA ✅
**P2 · Esforço P**

- **Evidência:** [FixModal.tsx:21](components/FixModal.tsx#L21) testa `/^Revise o trecho conforme a regra/i`, mas o texto genérico realmente usado é *"Revise o trecho conforme a **recomendação**."* ([lib/review.ts:246](lib/review.ts#L246)). A regex **nunca casa**.
- **Hoje:** para todo achado de IA sem sugestão específica, a textarea abre com a frase genérica **mais** a linha-guia — exatamente a duplicação que o comentário do código diz evitar.
- **Como corrigir:** comparar com as constantes reais (exportá-las de um único lugar em vez de duplicar a string em três arquivos).
- **Aceite:** achado de IA sem sugestão específica abre a textarea só com a linha-guia.

### UX-10 · Sem exportação de dados (SARIF, CSV, JSON) 💡
**P2 · Esforço M**

- **Evidência:** [app/report/[id]/page.tsx:69](app/report/[id]/page.tsx#L69) — a única exportação é `window.print()`.
- **Hoje:** não dá para levar os achados para o GitHub Code Scanning, Jira, planilha ou pipeline de CI. É o que separa "demo" de "ferramenta adotada".
- **Como corrigir:** `GET /api/analyses/:id/export?format=sarif|csv|json`. **SARIF 2.1.0** é o formato que o GitHub Code Scanning consome direto — alto retorno para pouco esforço, já que o modelo de dados interno é praticamente o do SARIF.
- **Aceite:** o SARIF exportado sobe no GitHub Code Scanning sem erro de validação.

### UX-11 · `<select>` nativo destoa do resto da interface ✅
**P2 · Esforço P**

- **Evidência:** [TokenPicker.tsx:62-78](components/TokenPicker.tsx#L62-L78) usa `<select>`, enquanto [filters.tsx:3-5](components/filters.tsx#L3-L5) declara a convenção do projeto: *"seletor via popover próprio (sem `<select>` nativo)"*.
- **Como corrigir:** reaproveitar o padrão de `flt-dd` de `filters.tsx`.

### UX-12 · Sem suporte a `prefers-reduced-motion` ✅
**P2 · Esforço P**

- **Evidência:** `grep -c "prefers-reduced-motion" app/globals.css` = **0**, com spinners e transições em uso.
- **Como corrigir:** bloco final no CSS zerando `animation-duration`/`transition-duration` quando a preferência estiver ativa.

### UX-13 · Foco visível insuficiente ✅
**P2 · Esforço P**

- **Evidência:** apenas 2 ocorrências de `focus-visible` em 3.157 linhas de CSS.
- **Como corrigir:** regra global `:focus-visible { outline: 2px solid hsl(var(--accent)); outline-offset: 2px }` e conferir contraste em ambos os temas.

### UX-14 · Erros aparecem como blocos estáticos, sem ação ✅
**P2 · Esforço M**

- **Hoje:** todo erro vira `<div className="alert error">` no topo do painel. Sem "tentar novamente", sem descartar, e fora da área visível se a rolagem já desceu.
- **Como corrigir:** sistema de *toast* com ação de retry e um `<ErrorBoundary>` por rota.

### UX-15 · Estado vazio da lista de achados não distingue "limpo" de "não rodou" ✅
**P2 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** `ran` passou a significar "o analisador REALMENTE executou": cada scanner é isolado (um binário ausente não derruba o outro nem a fase) e devolve `note` explicando. A tela distingue "nada encontrado" de "nada foi procurado".

- **Evidência:** [results/[id]/page.tsx:502-506](app/results/[id]/page.tsx#L502-L506) — "Nenhuma correção encontrada 🎉" aparece sempre que `corrections.length === 0` e a fase terminou, **inclusive quando o SAST não rodou** (binário ausente, `ran: false`).
- **Hoje:** o usuário comemora um repositório "limpo" que na verdade nunca foi escaneado. Grave num produto de segurança.
- **Como corrigir:** checar `scan.sast.ran` / `scan.sca.ran` / `review.ran` e, se algum for `false`, mostrar o aviso com o motivo (`review.note` já traz o texto pronto).
- **Aceite:** com `SAST_ENGINE=none`, a aba mostra "SAST não executado" em vez de "nenhuma vulnerabilidade".

### UX-16 · Análise em andamento não avisa quando algo dá errado no meio 💡
**P2 · Esforço P**

- **Hoje:** se a Fase 3 falha, o `PipelineStepper` fica vermelho, mas o usuário que está na aba "Visão geral" não é avisado.
- **Como corrigir:** faixa persistente no topo quando qualquer fase estiver com erro, com link para a aba correspondente.

### UX-17 · Não dá para reprocessar uma análise 💡
**P2 · Esforço M**

- **Hoje:** para re-escanear o mesmo repositório é preciso redigitar tudo na tela inicial.
- **Como corrigir:** botão "Rodar de novo" que cria uma análise nova com as mesmas entradas e liga as duas (`previous_analysis_id`), habilitando comparação ("3 achados novos, 5 resolvidos desde a última").
- **Depende de:** `FEAT-01`.

### UX-18 · Sem indicação de progresso real dentro de uma fase 💡
**P3 · Esforço M**

- **Hoje:** o progresso salta 25 → 50 → 80 → 100 ([lib/jobs.ts:228-239](lib/jobs.ts#L228-L239)). A Fase 3 pode levar 8 minutos parada nos 50%.
- **Como corrigir:** subestados por fase ("clonando", "SAST 1969 regras", "SCA", "revisão IA") gravados em `phases[k].stage`.

### UX-19 · Página inicial não valida a URL do repositório antes de enviar ✅
**P3 · Esforço P**

- **Evidência:** [app/page.tsx:48](app/page.tsx#L48) — `canSubmit` só exige nome e descrição. A URL inválida só falha no servidor ([validation.ts:48-52](lib/validation.ts#L48-L52)).
- **Como corrigir:** validar no `RepoInput` com o mesmo `parseGitHubRepo` (isolar num módulo isomórfico) e mostrar o erro no campo.

### UX-20 · Sem confirmação ao sair com análise em andamento 💡
**P3 · Esforço P**

- **Como corrigir:** `beforeunload` quando houver correções geradas e não salvas (some com o `FEAT-02`).

### UX-21 · Idioma do relatório impresso não é otimizado para PDF ✅
**P3 · Esforço P**

- **Hoje:** `window.print()` com `no-print` em alguns elementos. Sem cabeçalho/rodapé de página, sem quebra controlada, sem sumário.
- **Como corrigir:** `@page` com margens, `break-inside: avoid` nos cards, numeração e capa com metadados (data, repositório, engines usados).

---

# BLOCO 4 · P2/P3 — Bugs restantes

### BUG-09 · A coluna "Origem" do monitoramento é sempre "—" ✅

> ✅ **Corrigido em 27/07/2026.** `hashIp()` passado no 4º parâmetro de `audit()` em login, refresh e logout — verificado no banco: `ip_hash` preenchido e nenhum IP legível no `meta`.

**P2 · Esforço P** — `audit()` aceita `ipHash` como 4º parâmetro ([lib/auth.ts:193-202](lib/auth.ts#L193-L202)) e **nenhuma das 16 chamadas** o passa. A coluna `ip_hash` ([db/schema.ts:154](db/schema.ts#L154)) é sempre nula e a tela ([monitoring/page.tsx:187-189](app/admin/monitoring/page.tsx#L187-L189)) mostra "—". Corrigir junto com `SEC-05`.

### BUG-10 · Correção "gerada" idêntica ao original, sem avisar ✅

> ✅ **Corrigido em 27/07/2026.** `generateFix` agora **lança** quando a IA não devolve código; quando devolve algo idêntico ao original, marca `noChange` — a UI avisa e desabilita o botão de PR.

**P2 · Esforço P** — [lib/tasks.ts:217-221](lib/tasks.ts#L217-L221): se a IA não devolver `fixedCode`, `fixedCode` recebe o próprio original e a explicação vira o texto padrão *"Correção gerada pela IA."*. O usuário vê uma "correção" que não corrige — e pode abrir um PR vazio. Corrigir: se `!parsed.fixedCode`, lançar erro explícito; se `fixedCode.trim() === originalCode.trim()`, avisar na UI ("a IA não propôs alteração").

### BUG-11 · Análise órfã fica "pendente" para sempre ✅
**P2 · Esforço M** — [lib/jobs.ts:212-213](lib/jobs.ts#L212-L213): `runJob` faz `if (!raw) return;` silencioso. Os segredos vivem num `Map` em memória ([:39-41](lib/jobs.ts#L39-L41)) e o job é disparado com *fire-and-forget* ([:286-291](lib/jobs.ts#L286-L291)). Se o processo reiniciar (deploy no Render!) entre a criação e a execução — ou durante a execução — a análise fica `pending`/`running` **eternamente**, sem timeout e sem mensagem. Corrigir: marcar `status: "error"` quando os segredos não existirem, e uma varredura que expira análises `running` há mais de N minutos. Solução real em `ARQ-04`.

### BUG-12 · Chamadas de IA sem timeout e sem retry ✅
**P2 · Esforço P** — [lib/ai.ts:44](lib/ai.ts#L44), [:78](lib/ai.ts#L78), [:109](lib/ai.ts#L109): nenhum `fetch` tem `signal`. Um provedor lento trava a fase até o `maxDuration` da rota. E um único 429 do provedor mata a fase inteira. Corrigir: `AbortSignal.timeout(120_000)` e retry com backoff em 429/500/502/503 (2 tentativas), respeitando `retry-after`.

### BUG-13 · Resposta truncada da IA vira erro confuso ✅
**P2 · Esforço P** — `callAnthropic` ([lib/ai.ts:61-70](lib/ai.ts#L61-L70)) ignora `stop_reason`. Quando o modelo estoura `max_tokens`, o JSON vem cortado e o usuário recebe *"Não foi possível parsear o JSON da IA"* ([:185](lib/ai.ts#L185)). Corrigir: ler `stop_reason === "max_tokens"` e devolver "resposta truncada — reduza o escopo ou aumente o limite", que é acionável.

### BUG-14 · Provedor OpenAI quebrado nos modelos atuais ✅
**P2 · Esforço P** — [lib/ai.ts:86](lib/ai.ts#L86) envia `max_tokens`; os modelos recentes da OpenAI exigem `max_completion_tokens` e rejeitam `temperature` fora do padrão. Como o produto se vende como *headless* (troca de provedor por env), `AI_PROVIDER=openai` provavelmente falha com 400. Corrigir e, de preferência, testar os três provedores.

### BUG-15 · Dedup da revisão por IA descarta achados legítimos ✅
**P3 · Esforço P** — [lib/review.ts:171-179](lib/review.ts#L171-L179): no mesmo arquivo, `Math.abs(linha_sast - linha_ia) <= 3` descarta **independentemente do tipo de problema**. Um IDOR na linha 40 é descartado porque o SAST achou um `console.log` na 42. Corrigir: exigir proximidade **e** (mesmo CWE **ou** mesma categoria); só usar a distância isolada quando não houver CWE dos dois lados.

### BUG-16 · A Fase 4 automática corrige só o achado mais grave, e mal ✅
**P3 · Esforço P** — [lib/jobs.ts:241-256](lib/jobs.ts#L241-L256): gera correção só para o topo da lista e chama `generateFix` **sem `repoUrl`** — ou seja, sem o arquivo inteiro e sem o engine de agente, justo o caminho de menor qualidade. O usuário compara com a correção sob demanda (que usa o arquivo completo) e vê duas qualidades diferentes para o mesmo produto. Corrigir: passar `repoUrl`/`token` também aqui, ou remover a geração automática e deixar tudo sob demanda (mais barato e mais coerente).

### BUG-17 · `npm run lint` não existe mais ✅
**P3 · Esforço P** — [package.json:13](package.json#L13) chama `next lint`, **removido no Next 16** (confirmado: `next lint --help` não reconhece o comando). Não há `.eslintrc*` nem `eslint.config.*`. Corrigir: adicionar `eslint` + `eslint-config-next` com flat config e trocar o script para `eslint .`.

> ✅ **Entregue em 27/07/2026.** `npm run lint` passou a chamar `eslint .`; `next lint` não existe mais no Next 16.

### BUG-18 · `PRIVATE_HOST_RE` é código morto ✅
**P3 · Esforço P** — [lib/validation.ts:37](lib/validation.ts#L37) testa IP privado **depois** de já ter exigido `host === "github.com"` ([:36](lib/validation.ts#L36)). Nunca pode ser verdadeiro. Inofensivo, mas passa falsa sensação de proteção anti-SSRF; ou remover, ou reposicionar caso a allowlist deixe de ser fixa.

### BUG-19 · `useMe` guarda cache de módulo que não expira ✅
**P3 · Esforço P** — [lib/useMe.ts:15](lib/useMe.ts#L15). `clearMe()` é chamado nos lugares certos (conta e logout), mas se o papel mudar por ação de um superadmin, a interface do usuário afetado continua mostrando o papel antigo até recarregar. Corrigir: revalidar no foco da janela ou incluir o papel na resposta do refresh.

### BUG-20 · `patchAnalysis` sobrescreve o JSONB inteiro ✅
**P3 · Esforço P** — [lib/repos/analyses.ts:93-102](lib/repos/analyses.ts#L93-L102) grava `phases` inteiro a cada atualização. Hoje só o `runJob` escreve, então não há conflito; quando o `FEAT-01` passar a gravar estado de achado, vira condição de corrida. Corrigir preventivamente com `jsonb_set` ou movendo os achados para tabela própria (o que o `FEAT-01` já faz).

### BUG-21 · `progress` não reflete falha parcial ✅
**P3 · Esforço P** — [lib/jobs.ts:261-267](lib/jobs.ts#L261-L267) grava `progress: 100` mesmo com fases em erro. A lista mostra "100%" e status "erro" ao mesmo tempo.

### BUG-22 · Sem `deletedAt` em análises na interface ✅
**P3 · Esforço P** — a coluna `analyses.deleted_at` existe e é filtrada nas consultas, mas **nenhuma rota** exclui uma análise. Ou expor a exclusão (com CSRF e checagem de dono), ou remover a coluna.

---

# BLOCO 5 · P3 — Arquitetura e qualidade

### ARQ-01 · Nenhum teste automatizado ✅
**Esforço G** — sem Jest/Vitest/Playwright e sem `__tests__`. Num produto de segurança, o mínimo: testes unitários de `parsers`, `validation`, `ratelimit`, `crypto`, `jwt`; testes de integração das rotas de auth (incluindo os cenários de `SEC-02`/`SEC-03`); e um teste de fumaça ponta a ponta. **Comece pelos bugs deste documento** — cada correção entra com o teste que a trava.

> ✅ **Entregue em 27/07/2026.** 59 testes de unidade (vitest) em `tests/`, cada um citando o item da auditoria que protege. Cobertura: catálogo/fingerprint/redação 100%, validação e diff 93%, rate limit e paginação 88%. As 3 suítes de navegador foram promovidas para `e2e/` com README de execução.

### ARQ-02 · Sem ESLint configurado ✅
**Esforço P** — ver `BUG-17`. Adicionar `eslint-plugin-jsx-a11y` (pegaria boa parte do bloco de UX) e `eslint-plugin-security`.

> ✅ **Entregue em 27/07/2026.** ESLint 9 com flat config nativo do `eslint-config-next` — 0 erros. `no-explicit-any` como erro e `jsx-a11y` incluído.

### ARQ-03 · Sem CI ✅
**Esforço M** — não há `.github/workflows`. Mínimo: `typecheck` + `lint` + testes + `docker build` em cada PR. E, como *dogfooding* já previsto no README, rodar o próprio StarGuard sobre o repositório.

> ✅ **Entregue em 27/07/2026.** `.github/workflows/ci.yml` com typecheck + lint + testes + build da imagem, mais um passo de dogfooding rodando o Opengrep sobre o próprio repositório. Actions fixadas por SHA.

### ARQ-04 · Jobs em memória, sem fila 💡
**Esforço G** — causa raiz de `BUG-11`. Com o Render reiniciando a cada deploy, análises longas morrem. Solução proporcional ao MVP: tabela `job_queue` no Postgres (`SELECT ... FOR UPDATE SKIP LOCKED`), com `heartbeat` e retomada na inicialização. Evita introduzir Redis/BullMQ agora.

### ARQ-05 · Polling em vez de push 💡
**Esforço M** — trocar o polling da tela de resultados por SSE (`GET /api/status/:id/stream`). Resolve `BUG-03` de raiz e melhora a percepção de tempo real.

### ARQ-06 · Segredos do job só em memória impedem escalar 💡
**Esforço M** — [lib/jobs.ts:39-41](lib/jobs.ts#L39-L41). Com 2 instâncias, o `runJob` pode cair na instância que não tem os segredos e a análise silenciosamente não roda. Como o token já é cifrado no banco (`AES-256-GCM`), guardar o **`tokenId`** no job e decifrar na hora do uso resolve sem perder a garantia de "nunca em claro no banco".

### ARQ-07 · Sem observabilidade 💡
**Esforço M** — só `console.log`. Sem métrica de duração por fase, taxa de erro, custo de IA ou latência de scanner. Mínimo: log estruturado em JSON com `jobId`/`userId`/`phase`/`durationMs` e um `/api/health` que reporte o estado do banco e a presença dos binários.

### ARQ-08 · Custo de IA não é medido nem limitado ✅
**Esforço M** — `FIX_AGENT.maxBudgetUsd` limita **só** o engine de agente ([lib/config.ts:41](lib/config.ts#L41)). As chamadas via API não têm teto, não registram `usage` e não aparecem em lugar nenhum. Um lote de 50 correções pode custar caro sem qualquer aviso. Corrigir: capturar `usage` das três APIs, gravar em `finding_fixes.cost_usd` (`FEAT-02`), exibir custo por análise e teto por usuário/dia.

### ARQ-09 · Tela de resultados com 720 linhas ✅
**Esforço M** — [app/results/[id]/page.tsx](app/results/[id]/page.tsx) concentra polling, dedup, estado de correção, estado de PR, seleção em lote e cinco abas. Extrair `useAnalysisPolling`, `useFixFlow`, `useSelection` e um componente por aba — pré-requisito prático para `UX-01` e `FEAT-01`.

### ARQ-10 · Lógica de deduplicação duplicada ✅
**Esforço P** — `collidesWithSast` existe em [lib/review.ts:171](lib/review.ts#L171) (servidor) **e** em [results/[id]/page.tsx:209-215](app/results/[id]/page.tsx#L209-L215) (cliente), com regras **diferentes**: o servidor descarta por proximidade OU CWE; o cliente exige proximidade E (CWE ou regra). Os dois filtram o mesmo conjunto com critérios distintos. Unificar num único módulo compartilhado.

### ARQ-11 · Textos de domínio espalhados como literais ✅
**Esforço M** — a frase-guia de correção está duplicada **literalmente** em [parsers.ts:80](lib/parsers.ts#L80) e [FixModal.tsx:20](components/FixModal.tsx#L20), com uma terceira variante no prompt do agente ([agent-fix.ts:24](lib/agent-fix.ts#L24)). Causa direta de `UX-09`. Centralizar em `lib/constants.ts` — e é pré-requisito do `FEAT-04`.

> ✅ **Entregue em 27/07/2026.** `lib/constants.ts` centraliza a frase-guia de correção e o reconhecimento de sugestão genérica, que estavam duplicados em `parsers.ts`, `FixModal.tsx` e `agent-fix.ts`. É também a base do i18n do FEAT-04.

---

# Plano de execução sugerido

| Sprint | Itens | Resultado |
|---|---|---|
| **1** (2–3 d) | BUG-01 a BUG-05, SEC-01, SEC-04 | O app fica **usável**: sem 429, sem relogin, sem vazar token |
| **2** (2–3 d) | BUG-06, BUG-07, BUG-08, SEC-02, SEC-03, BUG-10, UX-15 | Fluxo de correção/PR passa a ser **confiável** |
| **3** (4–5 d) | FEAT-01 + FEAT-02 (+ ARQ-09 antes) | Estado por achado e fim do desperdício de tokens |
| **4** (3–4 d) | UX-01, UX-02, UX-04, UX-05, UX-06 | A interface aguenta um repositório real |
| **5** (3–4 d) | FEAT-03, ARQ-11 | Vulnerabilidades bem descritas |
| **6** (5+ d) | FEAT-04 | Multi-idioma ponta a ponta |
| **Contínuo** | ARQ-01, ARQ-02, ARQ-03 | Cada correção acima entra com teste |

**Regra de ouro para o Sprint 1:** cada um dos 5 primeiros bugs tem correção de poucas horas
e resolve, junto, 100% da dor que você relatou. Não comece pelas features.

---

## Nota de método — o que foi verificado e o que não foi

**Verificado executando:** o rate limit de login (simulação com a configuração real do seu
`.env.local`: 5 logins corretos, o 6º bloqueado por 15 min); `tsc --noEmit` (limpo);
a inexistência de `next lint` no Next 16; a ausência de chamadas a `/api/auth/refresh`,
de infraestrutura de i18n, de testes e de `prefers-reduced-motion`.

**Verificado por leitura completa do código** (sem executar o caminho): todo o restante.
Os itens marcados ⚠️ ou 💡 são, respectivamente, deduções sólidas a partir do código e
propostas de desenho — não observações de comportamento em execução.

**Fora do escopo desta vistoria:** os 3.157 linhas de `app/globals.css` foram inspecionadas
apenas por consultas pontuais (foco, movimento, breakpoints), não linha a linha; não houve
teste em navegador real, nem verificação de contraste de cores, nem teste com leitor de
tela, nem análise de performance de renderização. Um passe de acessibilidade com ferramenta
dedicada (axe) provavelmente acrescentaria itens ao Bloco 3.
