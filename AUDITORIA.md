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

**Placar:** 23 bugs · 9 itens de segurança · 21 de UX/UI · 8 features · 11 de arquitetura = **72 itens**.

## Progresso

| Sprint | Itens | Situação |
|---|---|---|
| **1 — Destravar o uso** | BUG-01 · BUG-02 · BUG-03 · BUG-04 · BUG-05 · BUG-09 · SEC-01 · SEC-04 · SEC-05 · SEC-07 · SEC-08 (parcial) | ✅ **entregue e testado** em 27/07/2026 |
| **2 — Fluxo de correção** | BUG-06 · BUG-07 · BUG-08 · BUG-10 · SEC-02 · SEC-03 · UX-15 | ✅ **entregue e testado** em 27/07/2026 |
| **3 — Estado e cache** | FEAT-01 · FEAT-02 | ✅ **entregue e testado** em 27/07/2026 |
| **4 — Interface** | UX-01 · UX-02 · UX-04 · UX-05 · UX-06 | ✅ **entregue e testado em navegador** em 27/07/2026 |
| **5 — Descrições** | FEAT-03 · ARQ-11 | ✅ **entregue e testado em navegador** em 27/07/2026 |
| **6 — Idioma** | FEAT-04 | ✅ **entregue** em 27/07/2026 — três idiomas, varredura completa (Sprint 8) |
| **Contínuo — Qualidade** | ARQ-01 · ARQ-02 · ARQ-03 · BUG-17 | ✅ **entregue** em 27/07/2026 |
| **Varredura de pendências** | 18 das 19 pendências abertas | ✅ **resolvidas e verificadas** em 27/07/2026 |
| **7 — Backlog P1/P2/P3** | SEC-06 · BUG-11 a BUG-22 · ARQ-10 · UX-03 · UX-04 (resto) · UX-07 · UX-08 · UX-10 · UX-11 · UX-12 · UX-13 · UX-19 · PEND-23 | ✅ **entregue** em 27/07/2026 |
| **8 — Vistoria de idioma** | FEAT-04 (fechamento) · UX-22 · PEND-29 | ✅ **entregue** em 27/07/2026 |
| **Correção pontual** | BUG-23 | ✅ **corrigido e medido em Chromium** em 28/07/2026 — a suíte de `e2e/` pela tela real segue pendente, ver PEND-32 |
| Próxima | ARQ-12 (sintoma) · UX-14 · UX-16 · UX-17 · UX-18 · UX-20 · UX-21 · SEC-09 · ARQ-04 a ARQ-09 · PEND-24 a PEND-32 | ⬜ a fazer |

<details>
<summary><strong>Como o Sprint 8 foi validado</strong></summary>

Suíte de unidade, tipos e lint. **Não houve execução em navegador nem contra
banco** — ver PEND-30 e PEND-31.

| Verificação | Resultado **medido** |
|---|---|
| Idiomas suportados | 3 — `pt-BR`, `en`, `es` (era 2, e o inglês era `Partial`) |
| Chaves por idioma | **583 em cada um** (eram 434 só em português; 149 chaves novas) |
| Paridade de chaves | Garantida pelo **tipo**: `EN`/`ES` são `Record<MessageKey, string>`, não `Partial` — chave sem tradução **não compila** |
| Catálogo de explicações | 54 entradas (40 regras + 14 CWEs) nos **três** idiomas, com paridade travada em teste |
| Literais em `placeholder`/`title`/`aria-label` | 0 nas 31 telas e componentes varridos (havia 18) |
| Literais entre tags no JSX | 0 nas mesmas 31 (a varredura anterior cobria 9) |
| Mensagem de erro de API | Traduzida pela **chave** em 23 pontos de tela; antes 100% deles mostravam o texto do servidor, em português |
| Texto gravado no JSONB | Escrito já traduzido: `phases[].error`, `sast.note`, `sca.note`, rótulos de checagem de skill e achados heurísticos |
| Exportação | Cabeçalho do CSV e `help.text` do SARIF seguem o idioma; **chaves do JSON não** (contrato de máquina), fixado em teste |
| Suíte | **258 testes, 21 arquivos, todos passando** (eram 243) |
| `npm run typecheck` | limpo |
| `npm run lint` | 0 erros; 10 avisos de `set-state-in-effect`, todos **pré-existentes** |

Testes novos: `tests/i18n-server.test.ts` (7) e `tests/results-tabs.test.ts`
(7), mais os de paridade dos três idiomas, varredura de literal por atributo,
contrato do `jsonError` e idioma da exportação.

</details>

### UX-22 · A aba "Ameaças" prometia achados e entregava contrato ✅
**P2 · Esforço P**

> ✅ **Entregue em 27/07/2026.** A aba foi renomeada para **Requisitos**, perdeu
> o contador e ganhou uma descrição que diz o que ela é.

- **Evidência:** o rótulo "Ameaças" e a descrição *"levanta ameaças plausíveis…"*
  faziam a aba parecer um segundo lugar onde se lê achado. Não é: ela mostra os
  **requisitos** que a Fase 1 extraiu do contexto e que a Fase 3 usa como
  contrato ([review.ts:253](lib/review.ts#L253) injeta a lista no prompt; o foco
  nº 1 da revisão é conferir o código contra ela). As **violações** aparecem em
  Correções, com o selo `R-xx` no card. Confundir as duas coisas custa caro num
  produto de segurança: quem procurava problema abria a aba errada.
- **O contador era o pior dos dois:** `Ameaças 12` ao lado de `Correções 3` dá
  peso visual a 12 hipóteses **não verificadas** sobre 3 achados exploráveis —
  o oposto do que a própria revisão exige de si (*"nada de vulnerabilidade
  teórica"*, [review.ts:47](lib/review.ts#L47)). Contador agora só em
  Correções, que é de onde sai o Pull Request.
- **Entregue:** rótulo `tab.requirements` nos três idiomas; descrição reescrita
  dizendo explicitamente que a lista **não** traz problemas do código e para
  onde ir; contadores removidos de Dependências, Requisitos e Skills; regra
  extraída para [lib/results-tabs.ts](lib/results-tabs.ts) — antes ela vivia
  inline num componente de 1200 linhas e só o navegador a alcançava.
- **Ordem mantida** (Visão geral · Correções · Dependências · Requisitos ·
  Skills), e agora travada em teste: trabalho primeiro (as duas abas que geram
  PR), leitura depois. Bate com o subtítulo e com o CTA, que mandam começar
  pelas correções.
- **Aceite:** abrir a aba e entender, sem ler o código, que aquilo é o que será
  conferido — e não o que foi encontrado. ⚠️ **Não verificado em navegador** —
  ver PEND-29.

<details>
<summary><strong>Como o Sprint 7 foi validado</strong></summary>

Suíte de unidade, tipos, lint e build de produção. **Não houve execução em
navegador nem contra banco** — ver PEND-24 a PEND-27.

| Verificação | Resultado |
|---|---|
| Testes de unidade | **184 em 17 arquivos** (era 86) — 2 arquivos novos por item de risco |
| `npm run typecheck` | limpo |
| `npm run lint` | **0 erros** (11 avisos: a decisão registrada em PEND-20) |
| `npm run build` | passa; a rota `/api/analyses/[id]/export` aparece no manifesto |
| Cobertura dos módulos novos | `github-auth` 100% · `dedup` 97% · `export` 92% · `repo-links` 100% |
| Dicionários pt-BR × en | **434 chaves cada**, com teste travando a paridade e a interpolação |

**Cada correção entrou com o teste que a trava** — `resolveGitHubToken · SEC-06`,
`timeout e retry · BUG-12`, `resposta truncada · BUG-13`, `OpenAI nos modelos
atuais · BUG-14`, `collidesWithSast · BUG-15`, `computeProgress · BUG-21`,
`failUnfinishedPhases · BUG-11`, `DELETE /api/analyses/[id] · BUG-22`,
`repoFileLink · UX-08`, `toSarif · UX-10`, `paridade de chaves · PEND-23`.

**Três coisas encontradas ao fazer o trabalho, todas corrigidas:**
- O `t` da tradução colidia com o `t` do `.map()` dos tokens na tela de Conta —
  `tsc` pegou porque `TokenView` não é chamável. Num arquivo sem tipos, teria
  virado erro em runtime.
- `SEVERITY_LABEL_PT` e `CATEGORY_META` ficaram órfãos ao converter os enums
  para chave de tradução. Removidos: código morto num arquivo de domínio é
  exatamente o BUG-18.
- O `NewUserModal` ainda era a `<div>` crua com `onClick` no overlay — o UX-04
  tinha sido dado por entregue com ele de fora. Migrado para o `<Modal>`.

**Duas decisões de produto tomadas pelo dono, não pelo executor** — a auditoria
oferecia dois caminhos em cada uma: a Fase 4 **deixou de gerar correção
automática** (BUG-16) e a **exclusão de análise foi exposta** em vez de a coluna
ser removida (BUG-22).
</details>

<details>
<summary><strong>Como a varredura de pendências foi validada</strong></summary>

Aplicação real em container + Postgres, mais a suíte de unidade.

| Verificação | Resultado |
|---|---|
| Testes de unidade | **86 em 10 arquivos** (era 59) |
| `npm run lint` | 0 erros |
| `npm run typecheck` | limpo |
| Idioma segue a conta (PEND-19) | trocar grava em `users.locale`; login em outra máquina já vem com o cookie certo |
| Usuário excluído (PEND-07) | acesso cortado em **~30 s** (antes: 15 min) |
| Erros com chave de tradução (PEND-17) | 401, 403 e 404 chegam com `errorKey` — middleware **e** rotas |
| Catálogo (PEND-14/18) | **54 entradas por idioma**, com teste travando a paridade de chaves |
| Enriquecimento em lote (PEND-05/13) | 30 achados de 2 regras ⇒ **1** chamada de IA |
| PR multi-arquivo (PEND-06) | 3 arquivos ⇒ 1 branch, 1 PR; caminho repetido deduplicado |
| Backfill (PEND-11) | `npm run db:backfill-findings --dry-run` executado contra o banco |
| Fluxo principal traduzido (PEND-16) | 0 literais em login, menu, onboarding, listagem, resultados, cards, modais, diff |

**Dois problemas encontrados durante a varredura, ambos corrigidos:**
- O 401 mais comum vem do **middleware**, que tem helper próprio e não devolvia
  `errorKey` — a tradução de erro estaria incompleta justamente no caso mais
  frequente.
- A imagem Docker parou de construir: o `package-lock.json` é artefato da
  versão do npm que o gerou (npm 11 local × npm 10 da imagem). O Dockerfile
  passou a fixar a major do npm.
</details>

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

## Pendências

> Varredura de 27/07/2026: as 19 pendências abertas foram revisadas uma a uma e
> **18 foram resolvidas**. A PEND-23 foi fechada no Sprint 7. As sete abaixo
> nasceram dos Sprints 7 e 8 e são todas do mesmo tipo: **o que foi entregue
> não foi exercitado em uso real.** As três do Sprint 8 (PEND-29 a PEND-31)
> merecem leitura junta: o idioma está garantido por tipo e por teste, mas
> **nada disso prova que o espanhol lê bem na tela.**
>
> Acréscimo de 04/08/2026 (ARQ-13): as quatro novas (PEND-33 a PEND-36) são do
> **mesmo tipo de sempre**, e vale dizer sem rodeio. O motor foi exercitado de
> verdade — o terminal rodou o Trivy sobre este repositório e devolveu 20
> achados com o código de saída certo. As duas superfícies **novas** de tela,
> não: a extensão do VS Code nunca abriu num editor e o seletor da Tela 1 nunca
> foi aberto em navegador. Compilar e passar em teste de unidade não é o mesmo
> que funcionar na mão de alguém, e a PEND-33 é a que mais pesa.

| ID | Origem | O que falta | Por quê / o que fazer |
|---|---|---|---|
| **PEND-24** | Sprint 7 | Nada foi visto em navegador | O sprint inteiro foi validado por tipo, lint, unidade e build. O selo de confiança (UX-07), o link para o GitHub (UX-08), o menu de exportação (UX-10), o `Picker` no lugar do `<select>` (UX-11), o foco visível e o `prefers-reduced-motion` (UX-12/13) e as 7 telas traduzidas **nunca foram abertos**. Rodar as suítes de `e2e/` e acrescentar uma para o percurso de governança. |
| **PEND-25** | UX-10 | SARIF nunca subiu no Code Scanning | O critério de aceite do item é *"o SARIF exportado sobe no GitHub Code Scanning sem erro de validação"* — e isso exige um repositório real. O que existe é o formato travado por 14 asserções de unidade (schema, índice de regra, nível, `partialFingerprints`, localização do achado de SCA). Subir um arquivo real num repositório de teste fecha. |
| **PEND-26** | BUG-11 / BUG-22 | Nenhuma consulta nova rodou contra Postgres | `listStale`, `patchIfUntouchedSince` e `softDelete` são Drizzle novo em `lib/repos/`, que por decisão do projeto não tem teste de unidade. A rota de exclusão está coberta com o repositório mockado — a **consulta em si**, não. Rodar contra um Postgres descartável. *(Parcial em 27/07/2026: as migrações `0002`–`0004` foram aplicadas a um banco real e o login foi exercitado ponta a ponta pelo ARQ-12; as três consultas novas seguem sem execução.)* |
| **PEND-28** | ARQ-12 | O sintoma continua: 500 mudo | A causa do ARQ-12 foi corrigida (migrações aplicadas), mas **o modo de falha não**. Um banco atrás do código volta a derrubar o login exatamente do mesmo jeito no próximo deploy. Implementar a checagem de schema descrita no item. |
| **PEND-27** | BUG-12/13/14 | Os três provedores continuam sem chamada real | O retry, o timeout, o `stop_reason` e o `max_completion_tokens` estão cobertos com `fetch` mockado. Nenhuma chave de IA foi usada. O BUG-14 em especial nasceu de um contrato do provedor: só uma chamada real prova que a OpenAI voltou a funcionar. |
| **PEND-29** | Sprint 8 | Nenhuma tela foi aberta em espanhol | As 583 chaves × 3 idiomas estão travadas por tipo e por teste, mas **paridade de chave não é qualidade de tradução**: quebra de layout por texto mais longo, concordância de gênero e frase que só fica errada em contexto não aparecem em teste de unidade. Abrir o app nos três idiomas e percorrer os fluxos principais; de preferência com revisão de um falante nativo de espanhol. |
| **PEND-30** | Sprint 8 | O texto gerado por IA em espanhol nunca foi visto | `LOCALE_AI_NAME.es` instrui o modelo a responder em espanhol nas 4 fases (ameaças, skills, enriquecimento, correção). Isso é **instrução a modelo — pedido, não garantia**. Nenhuma chamada real foi feita em espanhol. Rodar uma análise com `sg_locale=es` e conferir que ameaças, explicações e a `explanation` da correção saem no idioma certo. |
| **PEND-32** | BUG-23 | A suíte `e2e/modal-foco.mjs` não rodou contra a app | O comportamento **foi medido em Chromium**, mas com o `NewUserModal` montado fora do Next por um banco de provas descartável — sem rota, sem sessão e sem banco. A suíte de `e2e/` cobre o mesmo percurso *pela tela real* (login → `/admin/users` → botão → modal) e não pôde rodar: a senha do `admin@starguard.local` no banco configurado não é mais a do `scripts/seed.mjs`. Rodar `node e2e/modal-foco.mjs` com uma credencial válida, ou contra o banco descartável do `e2e/README.md`. Vai junto do PEND-24. |
| **PEND-31** | Sprint 8 | A troca de `errorKey` não foi exercitada contra rota real | `jsonError(..., null)` para mensagem dinâmica e `useApiError()` na tela estão cobertos por unidade (7 asserções) e pelos testes de rota com repositório mockado. O percurso completo — rota real devolve 409/403, a tela mostra o texto no idioma do usuário — **não rodou**. Vai junto do PEND-24. |
| **PEND-33** | ARQ-13 | A extensão **ativa**, mas a interface dela nunca foi usada | *Parcial em 04/08/2026:* o `.vsix` foi gerado (`vsce package --no-dependencies`, 125,4 kB, 5 arquivos), instalado com `code --install-extension` e **ativou no editor real** — `exthost.log` registra `_doActivateExtension starguard.starguard-vscode, activationEvent: 'workspaceContains:.git'` às 05:50:03, sem nenhum erro depois. Ou seja: o bundle CJS carrega no extension host e `activate()` roda até o fim. O que **continua sem verificação** é tudo o que exige mão humana: a árvore lateral desenhada, o ▶ por analisador, o sublinhado na linha certa do painel Problemas, a lâmpada, o `vscode.diff` antes de gravar e o `WorkspaceEdit` depois. Percurso a fazer: abrir este repositório → StarGuard na barra lateral → ▶ em "Dependências vulneráveis" → conferir os achados no painel → aplicar uma correção pela lâmpada. |
| **PEND-34** | ARQ-13 | O seletor da Tela 1 não foi aberto em navegador | `AnalyzerPicker`, o `/api/analyzers`, o `ThreatInput` que só aparece quando é exigido e o `Collapsible` que se abre sozinho quando o repositório passa a ser obrigatório foram validados por tipo, lint e build. O schema condicional tem **13 asserções novas** em `tests/validation.test.ts`, mas paridade de schema não é qualidade de tela: falta ver o cartão desabilitado com o motivo, o desmarcar automático ao apagar a URL do repositório e as abas de resultado dizendo "não executado". Acrescentar `e2e/selecao-analisadores.mjs` — vai junto do PEND-24. |
| **PEND-35** | ARQ-13 | O terminal só foi exercitado com Trivy | `--only sca` rodou de verdade (20 achados, 24,7 s, código 1). O que **não** rodou: `--only sast` (o Opengrep está instalado, mas `SAST_RULES=auto` baixa regras da rede e o ambiente da execução não tinha), `--only business` e `--only threat` (exigem chave de IA), e o comando `fix` inteiro — inclusive o `--write`, que é o único caminho que grava no disco de alguém. Rodar com chave configurada e com um ruleset local (`SAST_RULES=<dir>`). |
| **PEND-37** | SEC-10 | **O fluxo de OAuth nunca rodou ponta a ponta** | As regras estão cobertas por 60 asserções, mas nenhuma delas subiu o servidor. O que **não** foi exercitado: `starguard login` abrindo o navegador de verdade, a tela de consentimento sendo aprovada, o código virando token, a renovação silenciosa depois de 15 min, e a extensão aparecendo no menu **Contas** do VS Code. Percurso: subir a app com Postgres, rodar `npm run cli -- login`, conferir `whoami`, e revogar em Conta → Dispositivos conectados esperando o CLI voltar a pedir login. |
| **PEND-38** | SEC-10 | A detecção de reuso não foi provocada contra um banco real | `decideRotation` é pura e tem teste; o que fica de fora é a ATOMICIDADE — o `UPDATE … WHERE current_jti = $antigo` que impede dois refresh simultâneos de gerarem duas rotações válidas. Isso é do Postgres e não é verificável por unidade (mesma razão pela qual `lib/repos/` não tem teste de unidade). Reproduzir: copiar `credentials.json`, fazer login de novo (rotaciona), restaurar a cópia e rodar um comando — a sessão deve cair e `oauth.reuse_detected` deve aparecer na trilha. |
| **PEND-39** | SEC-10 | As duas consultas novas nunca rodaram contra Postgres | `oauth_codes` e `oauth_sessions` são Drizzle novo, e a migração `0006` foi gerada mas **não aplicada**. Junta-se à PEND-26, que já registra o mesmo para as consultas do BUG-11/BUG-22. |
| **PEND-40** | SEC-12 | **O GitHub App nunca existiu** | Todo o caminho do webhook — assinatura, fila, clone do SHA, análise do diff, PR do bot — está escrito e coberto por 12 asserções, mas **nenhum App foi criado no GitHub**. Não há `GITHUB_APP_ID`, chave privada nem `GITHUB_WEBHOOK_SECRET` configurados, então a rota responde 503 hoje. Criar o App exige ser owner da organização: é o passo que só você pode dar. Depois dele, o percurso a exercitar é abrir um PR num repositório de teste e ver o `starguard[bot]` responder. |
| **PEND-41** | SEC-11 | O proxy de IA nunca foi chamado por um cliente real | A rota, a cota e o registro de consumo estão testados, mas o percurso completo — extensão logada → consentimento → chamada com Bearer → resposta do modelo → linha em `ai_usage` — **não rodou**. Depende da PEND-37 (o login ponta a ponta), e junta-se a ela. |
| **PEND-42** | ARQ-04 | A fila nunca processou um job de verdade | `FOR UPDATE SKIP LOCKED`, o backoff e a retomada de worker morto estão escritos; o que rodou contra Postgres real foi só o OAuth. Falta subir a app, criar uma análise e ver o worker pegá-la — e, principalmente, matar o processo no meio para conferir que outro a retoma. É a promessa central do ARQ-04 e é a que continua sem prova. |
| **PEND-43** | SEC-13 | O hook nunca segurou um commit real | Instalação, remoção, recusa de hook de terceiro e `core.hooksPath` têm teste. O que não foi visto: `git commit` de verdade com achado grave, com `starguard.hookBlocks=true`, num repositório com semgrep configurado. |
| **PEND-36** | ARQ-13 | Nenhum pacote foi publicado nem instalado de fora | `@starguard/core` e `@starguard/cli` compilam, e o `dist` do núcleo foi carregado em Node puro — mas sempre a partir do repositório, com o link do workspace. Um `npm pack` seguido de instalação limpa em outro diretório é o que provaria que o mapa de `exports` e o passo `add-extensions.mjs` cobrem tudo o que um consumidor externo importa. O mesmo vale para `vsce package` na extensão. |

### Histórico

> O que ficou de fora do que já foi marcado como corrigido. Cada linha é
> rastreável por ID e deve ser fechada antes de considerar o item concluído.

| ID | Origem | O que falta | Por quê / o que fazer |
|---|---|---|---|
| ~~PEND-01~~ | SEC-08 (S1) | ✅ **resolvida em 27/07/2026** |Backend Redis via API REST do Upstash (`RATE_LIMIT_REDIS_URL` + `RATE_LIMIT_REDIS_TOKEN`), sem dependência nova e funcionando no runtime edge. Falha do Redis degrada para o balde em memória em vez de trancar o login. |
| ~~PEND-02~~ | BUG-01 (S1) | ✅ **fechada em 27/07/2026** | Verificado em Chromium removendo o cookie de acesso e mantendo o refresh: a sequência observada foi `401 /api/findings/…` → `200 /api/auth/refresh` → `200 /api/findings/…`, sem passar pelo login. Falta apenas ver o keepalive de 5 min disparar por tempo — o caminho que ele usa é o mesmo já provado. |
| ~~PEND-03~~ | BUG-04/BUG-05 (S1) | ✅ **fechada em 27/07/2026** | O aviso de "conexão instável", o botão de retry e o debounce das buscas foram validados só por leitura e tipo. |
| ~~PEND-04~~ | BUG-08 (S2) | ✅ **resolvida em 27/07/2026** |Coberto por `tests/github.test.ts` com Octokit mockado: branch única, arquivos commitados e PR aberto. O incremento de `prs_count` acontece em `createPR`, no mesmo caminho testado. |
| ~~PEND-05~~ | BUG-06/BUG-10 (S2) | ✅ **resolvida em 27/07/2026** |`tests/enrich.test.ts` mocka a camada de IA: 30 achados de 2 regras produzem **1** chamada, e resposta incompleta é descartada em vez de aplicada pela metade. |
| ~~PEND-06~~ | BUG-07 (S2) | ✅ **resolvida em 27/07/2026** |`openPullRequestBatch` testado: 3 arquivos → 1 branch, 1 PR, e caminho repetido é deduplicado. |
| ~~PEND-07~~ | SEC-02 (S2) | ✅ **resolvida em 27/07/2026** |`requireSession` passou a reconferir a conta no banco com cache de 30s. Verificado na aplicação: usuário excluído mantém acesso por ~30s (antes: 15 min) e depois recebe 401. |
| ~~PEND-08~~ | ARQ-01 | ✅ **resolvida em 27/07/2026** |Fechada pelo ARQ-01 e ampliada desde então: **184 testes em 17 arquivos**. A linha ficou sem riscar por engano na varredura anterior — o texto ("nenhum teste automatizado") já não descrevia o repositório. |
| ~~PEND-23~~ | FEAT-04 | ✅ **resolvida em 27/07/2026** |As 4 telas de governança, o corpo da Conta, o relatório, `NewUserModal`, `PipelineStepper` e a lista de PRs passaram a usar `t()`. Fechadas junto as outras duas frentes do FEAT-04 que faltavam: **enums de domínio** (`SEVERITY_LABEL_PT` e os rótulos da trilha de auditoria viraram chave; ambos removidos do código) e **formatação** (`fmtNum` e a data do rodapé do relatório seguem o idioma ativo). **434 chaves por idioma**, com teste travando paridade e interpolação. |
| ~~PEND-09~~ | FEAT-01/02 (S3) | ✅ **fechada em 27/07/2026** — filtros, selos, ações de estado, modal e cache exercitados em Chromium real | Filtro Abertos/Resolvidos, selos de estado, botões "Já corrigi"/"Falso positivo" e carregamento da correção guardada ao reabrir o modal: validados por tipo e build, não em uso real. |
| ~~PEND-10~~ | FEAT-02 (S3) | ✅ **resolvida em 27/07/2026** |Coberto pelos testes de enriquecimento e pelo cache de correção já validado na API. |
| ~~PEND-11~~ | FEAT-01 (S3) | ✅ **resolvida em 27/07/2026** |`scripts/backfill-findings.mjs` (`npm run db:backfill-findings`), idempotente e com `--dry-run`. Executado contra o banco de teste. |
| ~~PEND-13~~ | FEAT-03 (S5) | ✅ **resolvida em 27/07/2026** |O caminho de IA do enriquecimento agora tem teste, com a camada `runAI` mockada. |
| ~~PEND-14~~ | FEAT-03 (S5) | ✅ **resolvida em 27/07/2026** |Catálogo ampliado de 38 para **54 entradas por idioma**, cobrindo Python, Go, Java, PHP e regras transversais (JWT, cripto, SSRF, SRI). |
| ~~PEND-15~~ | FEAT-03 (S5) | ✅ **resolvida em 27/07/2026** |`enrichDependencies` monta o texto por template — diz o pacote, a versão e para onde atualizar — sem custo de IA, nos dois idiomas. |
| ~~PEND-16~~ | FEAT-04 (S6) | ✅ **resolvida em 27/07/2026** |Fluxo principal 100% traduzido (login, menu, onboarding, listagem, resultados, cards, modais, diff, filtros, selos, datas). As telas de governança e o relatório seguem com literais — ver PEND-23. |
| ~~PEND-17~~ | FEAT-04 (S6) | ✅ **resolvida em 27/07/2026** |`jsonError` e o helper do middleware devolvem `errorKey`; `ApiError` carrega a chave e `useApiError()` traduz. Verificado: 401, 403 e 404 chegam com chave. |
| ~~PEND-18~~ | FEAT-04/03 (S6) | ✅ **resolvida em 27/07/2026** |Catálogo existe nos dois idiomas, com teste travando a **paridade de chaves** — entrada nova só em português quebra o build. |
| ~~PEND-19~~ | FEAT-04 (S6) | ✅ **resolvida em 27/07/2026** |Coluna `users.locale` (migração `0004`). Verificado: trocar o idioma grava na conta e um login novo em outra máquina já vem com o cookie certo. |
| ~~PEND-20~~ | ARQ-02 | ✅ **resolvida em 27/07/2026** |Decisão documentada em `eslint.config.mjs`: fica como AVISO. A regra é estática e não enxerga através do `await`; satisfazê-la exigiria reescrever 6 telas verificadas em navegador — risco sem ganho proporcional. |
| ~~PEND-21~~ | ARQ-01 | ✅ **resolvida em 27/07/2026** |`tests/routes.test.ts` cobre o handler de estado do achado com os repositórios mockados: sessão, CSRF, dono, id malformado e estado inválido. |
| ~~PEND-22~~ | ARQ-03 | ✅ **resolvida em 27/07/2026** |Job `e2e` no CI com Postgres como serviço, build de produção e Chromium; roda em pull request. |
| ~~PEND-12~~ | FEAT-01 (S3) | ✅ **resolvida em 27/07/2026** |Decisão registrada no código: `step3-scan` é rota avulsa headless e não cria análise — achados com estado dependem de uma análise à qual pertencer. |

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

> ✅ **Corrigido em 27/07/2026.** `lib/github-auth.ts`: o token do servidor só entra com `SINGLE_TENANT=true` explícito. Leitura sem token segue anônima (resolve repositório público); em repositório privado a resposta passou a ser "informe um token do GitHub" em vez de um 404 cru. Abrir PR exige token do próprio usuário. Teste cobre o caminho negativo.

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

### SEC-10 · Conta para a extensão e o terminal (OAuth PKCE) ✅

**Esforço G.** Depois do ARQ-13, o motor passou a rodar em três lugares — mas
só o painel tinha autenticação. A extensão e o CLI eram anônimos: usavam o
binário e a chave de IA da máquina de quem os rodava. Para a IA passar a ser
**pela conta da Starbridge**, com log central, era preciso primeiro saber
**quem** está pedindo.

O fluxo escolhido é **Authorization Code + PKCE**, e a razão é o tipo de
cliente: o `.vsix` é um zip e o pacote do CLI é código legível. **Todo segredo
embutido neles é público.** Daí as duas consequências que definem o desenho —
não há `client_secret`, e o PKCE faz o papel que ele faria.

> ✅ **Entregue em 04/08/2026.**
>
> **A senha nunca entra no editor nem no terminal.** O login acontece no
> navegador, na tela que já existe, com o Argon2id que já existe. O cliente só
> recebe um código que, sem o `code_verifier` que ele mesmo sorteou, não vale
> nada.
>
> **As cinco decisões de segurança:**
>
> 1. **PKCE `S256` obrigatório; `plain` recusado.** Em `plain` o desafio É o
>    verificador em texto — quem intercepta o pedido já tem o que precisa. É
>    PKCE no nome e nada na prática, e não há cliente antigo a acomodar.
> 2. **Código de autorização**: 32 bytes, guardado **hasheado** (um dump do
>    banco não pode render credencial), válido 60 s, **uso único garantido pelo
>    banco** (`UPDATE … WHERE used_at IS NULL` — com `SELECT` antes do `UPDATE`
>    haveria uma janela para duas emissões), e amarrado a
>    `client_id` + `redirect_uri` + `code_challenge`.
> 3. **Rotação com detecção de reuso.** Cada refresh emite um novo e mata o
>    anterior. Um refresh **já rotacionado** apresentado de novo significa
>    token repetido — a **família inteira cai** e `oauth.reuse_detected` vai
>    para a trilha. É a única defesa possível contra um refresh copiado do
>    disco: não dá para impedir o roubo a partir do servidor, dá para detectar
>    o uso.
> 4. **Públicos separados.** Token de cliente tem `aud: starguard-web-client`;
>    o do navegador, `starguard-web`. Um não vale pelo outro — têm tempos de
>    vida e superfícies de exposição diferentes demais para serem
>    intercambiáveis.
> 5. **CSRF pela ORIGEM da credencial.** Cookie exige; Bearer não (nenhum
>    navegador acrescenta `Authorization` sozinho). E `requireSession`
>    **não cai para o cookie** quando o Bearer falha — cair seria autenticar
>    por cookie sem CSRF, bastando mandar um header lixo junto.
>
> **`redirect_uri` é a fronteira do fluxo inteiro.** Se um destino não
> registrado passasse, o código iria para quem controla aquele destino, e o
> PKCE não salvaria (quem escolheu o destino escolheu o verificador). A
> comparação é por **estrutura** — esquema, host, caminho —, nunca por prefixo.
> O CLI aceita **qualquer porta** em `127.0.0.1` (RFC 8252 §7.3, a porta é
> efêmera) mas **não** `localhost`, que resolve por DNS.
>
> **Onde ficam os tokens:** `SecretStorage` no VS Code (chaveiro do SO) e
> `~/.starguard/credentials.json` com `0600` no terminal — só o refresh; o
> access dura 15 min e fica em memória.
>
> **Contrapartida obrigatória:** Conta → **Dispositivos conectados**, com
> revogar. Emitir credencial de 30 dias sem oferecer como cortá-la seria
> irresponsável — e é a ação que fecha um `oauth.reuse_detected`.
>
> **O que isto NÃO protege**, escrito no código e não subentendido: máquina de
> quem programa comprometida (o chaveiro é legível pelos processos daquele
> usuário) e extensão maliciosa no mesmo editor (o VS Code pede consentimento
> por extensão, o que reduz mas não elimina).

**Como o sprint foi validado**

| O que | Como | Resultado **medido** |
|---|---|---|
| Suíte | `npm test` | **471 testes** em 35 arquivos (eram 411 em 31); **+60**, quase todos de caminho negativo |
| PKCE e clientes | `tests/oauth-pkce.test.ts` | 26 asserções: `plain` recusado, verificador errado recusado, `vscode://` de **outra extensão** recusado, `localhost` recusado, `127.0.0.1@malicioso.com` recusado |
| Rotação | `tests/oauth-rotation.test.ts` | 10 asserções sobre a máquina de estados pura: reuso derruba a família, revogada tem precedência, famílias são independentes |
| Bearer e CSRF | `tests/http-bearer.test.ts` | 14 asserções, incluindo a principal: **Bearer inválido + cookie válido = 401**, e `getSession` do cookie **nem é chamada** |
| Credencial em disco | `packages/cli/tests/credentials.test.ts` | 10 asserções (2 puladas em Windows): `0600` na criação **e no reaperto** de arquivo preexistente; access token não é gravado |
| Migração | `npx drizzle-kit generate` | `0006`: `oauth_codes` + `oauth_sessions`, ambas novas — nenhuma tabela existente alterada |
| Build | `npm run build` + `build:packages` | Painel compila com as 4 rotas novas; extensão 434 kB |
| Terminal | `starguard whoami` / `logout` sem credencial | Mensagem acionável e **código de saída 2**; logout avisa que a sessão no servidor continua até ser revogada |
| Tipo cobrou tradução | `tsc` na extensão | `fix.apply`/`fix.applied` **não compilaram** até serem traduzidas nos três idiomas — a garantia do FEAT-04 funcionando |

**Uma intermitência que a mudança causou e vale registrar:** o import de
`@/lib/http` num teste passou a estourar os 5 s padrão do vitest sob carga
paralela, porque o grafo cresceu (`lib/auth` → `lib/config` →
`@starguard/core`). Isolado, custa 1,8 s. O teto foi ampliado no teste, com a
razão escrita — o sintoma parecia bug de lógica e não era.

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

### FEAT-04 · Internacionalização de verdade (UI + IA) ✅
**P1 · Esforço G** — *pedido explícito*

> ✅ **Entregue em 27/07/2026** (fundação no Sprint 6, extração no Sprint 7,
> **vistoria completa e espanhol no Sprint 8**).
>
> São **três idiomas — português (Brasil), inglês e espanhol — e nenhum é de
> segunda classe**: `EN` e `ES` deixaram de ser `Partial` e passaram a ser
> `Record<MessageKey, string>` completos, então **chave sem tradução não
> compila**. 583 chaves em cada idioma; catálogo de explicações com 54 entradas
> nos três, com paridade travada em teste.
>
> A vistoria do Sprint 8 fechou o que a extração anterior tinha deixado de fora
> — e que nenhum teste pegava, porque a varredura só olhava texto entre tags:
>
> | O que estava preso em português | Onde |
> |---|---|
> | `placeholder`, `title`, `aria-label` | `RepoInput`, `ThreatInput`, `SkillInput`, `TokenPicker`, `Modal`, `Pagination`, `SectionTabs`, `InfoTip` |
> | Rótulos e sub-rótulos de papel | `filters.tsx` (`RoleSelect`) |
> | Veredito e recomendação de skill | `SkillFindingCard` |
> | Título das abas, métricas do stepper, cobertura da revisão | tela de resultados |
> | `<title>` e `description` do documento | `app/layout.tsx` — agora `generateMetadata` por requisição |
> | Título e corpo do **Pull Request** | tela de resultados e `BatchFixModal` |
> | Aviso de lockfile | `lib/deps-fix.ts` — devolve **chave + valores**, não texto pronto |
> | Mensagem de erro de API | **23 pontos de tela** mostravam `err.message`, escrito em português pelo servidor. Agora vale a chave, via `useApiError()` |
> | Texto gravado no JSONB `phases` | `lib/jobs.ts`, `lib/tasks.ts`, `lib/skills.ts` — escrito **já traduzido**, no idioma de quem pediu a análise |
> | Cabeçalho do CSV e `help.text` do SARIF | `lib/export.ts` — o JSON ficou de fora **de propósito**: é contrato de máquina |
>
> Duas decisões que merecem registro, porque não são óbvias:
>
> - **Texto que o servidor grava sai já traduzido.** Ele é escrito uma vez e
>   lido do banco para sempre — não passa por `t()` na exibição. Por isso o
>   idioma acompanha o job (`Transient.locale`) e, quando o job já morreu
>   (análise órfã/abandonada), vem de `users.locale`.
> - **`jsonError(..., null)` existe.** Erro redigido de ferramenta externa e
>   detalhe do Zod não têm chave que os represente; trocá-los por um "Erro no
>   servidor." genérico apagaria a única informação acionável que o usuário tem.
>
> **Ainda não exercitado:** nenhuma tela foi aberta em espanhol e nenhuma
> chamada de IA rodou nesse idioma — ver PEND-29, PEND-30 e PEND-31. Paridade
> de chave não é qualidade de tradução.

- **Evidência:** zero infraestrutura de i18n (nenhum `next-intl`/`react-i18next`, nenhuma pasta `locales/`). [app/layout.tsx:40](app/layout.tsx#L40) fixa `lang="pt-BR"`. Todas as strings estão embutidas no JSX. Os **prompts** também são pt-BR e um deles ordena explicitamente `Output em PT-BR` ([lib/review.ts:38](lib/review.ts#L38)).
- **O ponto que costuma ser esquecido:** traduzir a interface não basta. Se a IA continuar respondendo em português, o usuário em inglês vê botões traduzidos e **conteúdo** em português. i18n aqui tem **quatro** frentes:

| Frente | Onde | Como | Situação |
|---|---|---|---|
| Interface | ~40 arquivos `.tsx` | `next-intl` + `messages/{pt-BR,en,es}.json` | ✅ sem lib: dicionário próprio em `lib/i18n/messages.ts`, cookie em vez de rota |
| Enums de domínio | `SEVERITY_LABEL_PT` ([types/index.ts:205](types/index.ts#L205)) | virar chave de tradução, não string | ✅ removido; severidade, estado do achado e evento de auditoria são chave |
| Saída da IA | `lib/tasks.ts`, `lib/review.ts`, `lib/skills.ts` | parâmetro `locale` no prompt: *"Responda em {locale}"* | ✅ nas 4 fases, incluindo a passada de IA das skills |
| Formatação | [listing.tsx:11](components/listing.tsx#L11) fixa `toLocaleString("pt-BR")` | receber o locale ativo | ✅ `fmtDate`/`fmtNum` leem o cookie |

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

> ✅ **Corrigido em 27/07/2026.** O dano maior sumiu com o FEAT-02 (a correção fica no banco e volta ao reabrir). O que ainda se perdia era o que o usuário **digitou** e não usou: `FixModal` e `NewUserModal` passaram a pedir confirmação quando há texto não aproveitado, e o `Modal` já bloqueia o fechamento durante a geração.

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

> ✅ **Entregue em 27/07/2026.** Selo "confiança média" no card — só no caso duvidoso, porque marcar "alta" em todo achado seria ruído. Filtro "Só alta" na barra de correções, que aparece apenas quando há o que filtrar.

- **Evidência:** `confidence: "high" | "medium"` é preenchido ([lib/review.ts:251](lib/review.ts#L251)) e nunca exibido — `grep` por `confidence` nos `.tsx` não retorna nada.
- **Como corrigir:** badge "confiança média" no `VulnerabilityCard` e filtro por confiança.
- **Aceite:** dá para esconder achados de confiança média com um clique.

### UX-08 · Não há link do achado para o código no GitHub 💡
**P2 · Esforço P**

> ✅ **Entregue em 27/07/2026.** `lib/repo-links.ts` monta `{repo}/blob/HEAD/{file}#L{a}-L{b}`. `HEAD` no lugar do `defaultBranch` evita persistir o branch em cada análise — o preço é que o link aponta para o código de agora, e o título do link diz isso. Recusa repositório fora da allowlist, caminho com `..` e o placeholder de arquivo desconhecido da revisão por IA.

- **Hoje:** o card mostra `file` e `line` como texto ([VulnerabilityCard.tsx:52-59](components/VulnerabilityCard.tsx#L52-L59)). Para ver o contexto real, o usuário abre o GitHub e navega à mão.
- **Como corrigir:** `{repoUrl}/blob/{defaultBranch}/{file}#L{line}-L{endLine}` — o `defaultBranch` já é buscado em `getRepoMeta`.
- **Aceite:** um clique abre a linha exata no GitHub.

### UX-09 · Instrução padrão duplicada nos achados da IA ✅
**P2 · Esforço P**

> ✅ **Corrigido em 27/07/2026 (pelo ARQ-11).** A regex que nunca casava deu lugar a `isGenericSuggestion` em `lib/constants.ts`, com a frase-guia num lugar só. `FixModal` usa a função; a duplicação some.

- **Evidência:** [FixModal.tsx:21](components/FixModal.tsx#L21) testa `/^Revise o trecho conforme a regra/i`, mas o texto genérico realmente usado é *"Revise o trecho conforme a **recomendação**."* ([lib/review.ts:246](lib/review.ts#L246)). A regex **nunca casa**.
- **Hoje:** para todo achado de IA sem sugestão específica, a textarea abre com a frase genérica **mais** a linha-guia — exatamente a duplicação que o comentário do código diz evitar.
- **Como corrigir:** comparar com as constantes reais (exportá-las de um único lugar em vez de duplicar a string em três arquivos).
- **Aceite:** achado de IA sem sugestão específica abre a textarea só com a linha-guia.

### UX-10 · Sem exportação de dados (SARIF, CSV, JSON) 💡
**P2 · Esforço M**

> ✅ **Entregue em 27/07/2026.** `GET /api/analyses/:id/export?format=sarif|csv|json`, com CSRF não aplicável (é GET) mas dono/superadmin checado. O SARIF sai com `security-severity`, tags de CWE/OWASP e `partialFingerprints` — sem eles o Code Scanning reabre todo achado a cada push. O CSV vai com BOM (Excel) e neutraliza injeção de fórmula, que importa porque o texto vem de repositório de terceiros. O JSON leva a cobertura (`sastRan`/`scaRan`/`reviewRan`), preservando a honestidade do UX-15. **Não exercitado contra o GitHub — ver PEND-25.**

- **Evidência:** [app/report/[id]/page.tsx:69](app/report/[id]/page.tsx#L69) — a única exportação é `window.print()`.
- **Hoje:** não dá para levar os achados para o GitHub Code Scanning, Jira, planilha ou pipeline de CI. É o que separa "demo" de "ferramenta adotada".
- **Como corrigir:** `GET /api/analyses/:id/export?format=sarif|csv|json`. **SARIF 2.1.0** é o formato que o GitHub Code Scanning consome direto — alto retorno para pouco esforço, já que o modelo de dados interno é praticamente o do SARIF.
- **Aceite:** o SARIF exportado sobe no GitHub Code Scanning sem erro de validação.

### UX-11 · `<select>` nativo destoa do resto da interface ✅
**P2 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** `Picker` genérico em `components/filters.tsx`, no padrão `flt-dd` que o arquivo já declarava como convenção — com grupos (no lugar do `<optgroup>`), `role=listbox`, ESC e clique-fora. `TokenPicker` e `NewUserModal` migrados; não sobrou `<select>` nativo.

- **Evidência:** [TokenPicker.tsx:62-78](components/TokenPicker.tsx#L62-L78) usa `<select>`, enquanto [filters.tsx:3-5](components/filters.tsx#L3-L5) declara a convenção do projeto: *"seletor via popover próprio (sem `<select>` nativo)"*.
- **Como corrigir:** reaproveitar o padrão de `flt-dd` de `filters.tsx`.

### UX-12 · Sem suporte a `prefers-reduced-motion` ✅
**P2 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** Bloco no fim do `globals.css` zerando `--duration-*` na origem, mais uma rede de segurança em `*`. O spinner é a exceção deliberada: ali o movimento **é** a informação, então ele desacelera em vez de parar — um círculo parado no lugar de um indicador de progresso seria pior.

- **Evidência:** `grep -c "prefers-reduced-motion" app/globals.css` = **0**, com spinners e transições em uso.
- **Como corrigir:** bloco final no CSS zerando `animation-duration`/`transition-duration` quando a preferência estiver ativa.

### UX-13 · Foco visível insuficiente ✅
**P2 · Esforço P**

> ✅ **Corrigido em 27/07/2026.** A regra global `:focus-visible` já existia — o problema eram três `outline: none` que a anulavam sem repor nada. O pior: o `InfoTip`, que é `tabIndex=0` com `role="button"` e dava para alcançar pelo teclado sem qualquer sinal na tela. Repostos com contorno sólido em InfoTip, busca dos popovers e campos de formulário.

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

> ✅ **Corrigido em 27/07/2026.** `RepoInput` chama o mesmo `parseGitHubRepo` do servidor (o módulo já era isomórfico), marca o campo com `aria-invalid` e explica o formato; `canSubmit` passa a exigir URL válida. Campo vazio continua válido — o repositório é opcional.

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

> ✅ **Corrigido em 27/07/2026.** Segredos ausentes deixaram de retornar em silêncio: a análise vira `error` com um motivo legível em cada fase inacabada. Somado a isso, `expireStaleAnalyses()` encerra o que ficou sem sinal de vida por 20 min (`ANALYSIS_STALE_MS`), de carona na criação de análise e no máximo uma vez por minuto. A escrita é condicional (`patchIfUntouchedSince`), então um job que voltou a responder não é atropelado. Solução definitiva continua sendo o ARQ-04.

### BUG-12 · Chamadas de IA sem timeout e sem retry ✅
**P2 · Esforço P** — [lib/ai.ts:44](lib/ai.ts#L44), [:78](lib/ai.ts#L78), [:109](lib/ai.ts#L109): nenhum `fetch` tem `signal`. Um provedor lento trava a fase até o `maxDuration` da rota. E um único 429 do provedor mata a fase inteira. Corrigir: `AbortSignal.timeout(120_000)` e retry com backoff em 429/500/502/503 (2 tentativas), respeitando `retry-after`.

> ✅ **Corrigido em 27/07/2026.** `AbortSignal.timeout` (120 s, `AI_TIMEOUT_MS`) nos três provedores, retry com backoff exponencial em 429/408/5xx honrando o `retry-after`, e `AbortSignal.any` para o chamador poder cancelar. Cancelamento explícito não consome retentativa; 4xx não reentrante não é repetido.

### BUG-13 · Resposta truncada da IA vira erro confuso ✅
**P2 · Esforço P** — `callAnthropic` ([lib/ai.ts:61-70](lib/ai.ts#L61-L70)) ignora `stop_reason`. Quando o modelo estoura `max_tokens`, o JSON vem cortado e o usuário recebe *"Não foi possível parsear o JSON da IA"* ([:185](lib/ai.ts#L185)). Corrigir: ler `stop_reason === "max_tokens"` e devolver "resposta truncada — reduza o escopo ou aumente o limite", que é acionável.

> ✅ **Corrigido em 27/07/2026.** `stop_reason: "max_tokens"` (Anthropic), `finish_reason: "length"` (OpenAI) e `finishReason: "MAX_TOKENS"` (Google) viram `AIError` com `code: "truncated"` e a mensagem acionável — no lugar de "não foi possível parsear o JSON".

### BUG-14 · Provedor OpenAI quebrado nos modelos atuais ✅
**P2 · Esforço P** — [lib/ai.ts:86](lib/ai.ts#L86) envia `max_tokens`; os modelos recentes da OpenAI exigem `max_completion_tokens` e rejeitam `temperature` fora do padrão. Como o produto se vende como *headless* (troca de provedor por env), `AI_PROVIDER=openai` provavelmente falha com 400. Corrigir e, de preferência, testar os três provedores.

> ✅ **Corrigido em 27/07/2026.** `max_completion_tokens` no lugar do `max_tokens` deprecado, e `temperature` deixou de ser enviada — os modelos de raciocínio rejeitam valor fora do padrão. Teste trava os dois. **Sem chamada real ao provedor — ver PEND-27.**

### BUG-15 · Dedup da revisão por IA descarta achados legítimos ✅
**P3 · Esforço P** — [lib/review.ts:171-179](lib/review.ts#L171-L179): no mesmo arquivo, `Math.abs(linha_sast - linha_ia) <= 3` descarta **independentemente do tipo de problema**. Um IDOR na linha 40 é descartado porque o SAST achou um `console.log` na 42. Corrigir: exigir proximidade **e** (mesmo CWE **ou** mesma categoria); só usar a distância isolada quando não houver CWE dos dois lados.

> ✅ **Corrigido em 27/07/2026 (junto com o ARQ-10).** Proximidade virou condição necessária, não suficiente: quando os dois lados declaram CWE, ele precisa bater. O caso do relatório — IDOR na 40 descartado porque o SAST viu um `console.log` na 42 — está travado por teste. Achado sem linha só colide por CWE.

### BUG-16 · A Fase 4 automática corrige só o achado mais grave, e mal ✅
**P3 · Esforço P** — [lib/jobs.ts:241-256](lib/jobs.ts#L241-L256): gera correção só para o topo da lista e chama `generateFix` **sem `repoUrl`** — ou seja, sem o arquivo inteiro e sem o engine de agente, justo o caminho de menor qualidade. O usuário compara com a correção sob demanda (que usa o arquivo completo) e vê duas qualidades diferentes para o mesmo produto. Corrigir: passar `repoUrl`/`token` também aqui, ou remover a geração automática e deixar tudo sob demanda (mais barato e mais coerente).

> ✅ **Corrigido em 27/07/2026.** A geração automática foi **removida** — decisão do dono do produto entre as duas saídas que o item oferecia. Motivo: ela produzia UMA correção, pelo pior caminho (sem `repoUrl`, logo sem arquivo inteiro e sem agente), e com `FIX_ENGINE=agent` (o padrão) custava um clone e até 4,5 min de agente em toda análise que ninguém pediu — contra o princípio já adotado no UX-05 e o cache do FEAT-02. Correção agora é sempre sob demanda; o stepper e o relatório dizem isso.

### BUG-17 · `npm run lint` não existe mais ✅
**P3 · Esforço P** — [package.json:13](package.json#L13) chama `next lint`, **removido no Next 16** (confirmado: `next lint --help` não reconhece o comando). Não há `.eslintrc*` nem `eslint.config.*`. Corrigir: adicionar `eslint` + `eslint-config-next` com flat config e trocar o script para `eslint .`.

> ✅ **Entregue em 27/07/2026.** `npm run lint` passou a chamar `eslint .`; `next lint` não existe mais no Next 16.

### BUG-18 · `PRIVATE_HOST_RE` é código morto ✅
**P3 · Esforço P** — [lib/validation.ts:37](lib/validation.ts#L37) testa IP privado **depois** de já ter exigido `host === "github.com"` ([:36](lib/validation.ts#L36)). Nunca pode ser verdadeiro. Inofensivo, mas passa falsa sensação de proteção anti-SSRF; ou remover, ou reposicionar caso a allowlist deixe de ser fixa.

> ✅ **Corrigido em 27/07/2026.** Removido. Ficou no lugar um comentário dizendo o que de fato protege (a allowlist) e o que precisa voltar se ela deixar de ser fixa — checagem no **IP resolvido**, não no nome, porque a regex antiga nem contra rebind de DNS servia. Um teste trava que destino interno continua barrado.

### BUG-19 · `useMe` guarda cache de módulo que não expira ✅
**P3 · Esforço P** — [lib/useMe.ts:15](lib/useMe.ts#L15). `clearMe()` é chamado nos lugares certos (conta e logout), mas se o papel mudar por ação de um superadmin, a interface do usuário afetado continua mostrando o papel antigo até recarregar. Corrigir: revalidar no foco da janela ou incluir o papel na resposta do refresh.

> ✅ **Corrigido em 27/07/2026.** O cache passou a envelhecer (60 s) e a revalidar ao voltar o foco para a aba — que é quando o usuário volta a olhar a tela. Um conjunto de assinantes faz a revalidação atualizar todos os `useMe()` montados, não só quem disparou o fetch.

### BUG-20 · `patchAnalysis` sobrescreve o JSONB inteiro ✅
**P3 · Esforço P** — [lib/repos/analyses.ts:93-102](lib/repos/analyses.ts#L93-L102) grava `phases` inteiro a cada atualização. Hoje só o `runJob` escreve, então não há conflito; quando o `FEAT-01` passar a gravar estado de achado, vira condição de corrida. Corrigir preventivamente com `jsonb_set` ou movendo os achados para tabela própria (o que o `FEAT-01` já faz).

> ✅ **Endereçado em 27/07/2026.** A corrida que o item previa não chegou a existir: o FEAT-01 levou os achados para a tabela `findings` — que é a alternativa apontada pelo próprio item. Hoje quem escreve `phases` é o `runJob` da própria análise. O segundo escritor introduzido pelo BUG-11 usa `patchIfUntouchedSince`, um UPDATE condicional que não casa se o job voltou a escrever. Registrado no código.

### BUG-21 · `progress` não reflete falha parcial ✅
**P3 · Esforço P** — [lib/jobs.ts:261-267](lib/jobs.ts#L261-L267) grava `progress: 100` mesmo com fases em erro. A lista mostra "100%" e status "erro" ao mesmo tempo.

> ✅ **Corrigido em 27/07/2026.** `computeProgress` deriva o percentual das fases concluídas em vez de cravar 100 no fim. Com uma fase em erro a lista mostra 75%, não "100% · erro".

### BUG-22 · Sem `deletedAt` em análises na interface ✅
**P3 · Esforço P** — a coluna `analyses.deleted_at` existe e é filtrada nas consultas, mas **nenhuma rota** exclui uma análise. Ou expor a exclusão (com CSRF e checagem de dono), ou remover a coluna.

> ✅ **Corrigido em 27/07/2026.** A exclusão foi **exposta** — decisão do dono do produto entre as duas saídas do item. `DELETE /api/analyses/:id` com CSRF, checagem de dono (404 para análise alheia, sem confirmar existência) e soft delete idempotente (já excluída devolve 404, não 200 mentindo). Botão com confirmação na listagem e evento `analysis.delete` na auditoria.

### BUG-23 · Não dá para digitar em formulário dentro de modal ✅
**P0 · Esforço P**

> ⚠️ **Encontrado em uso real em 28/07/2026**, relatado por quem tentou criar um
> usuário: *"não consigo digitar, quando digito ele seleciona o pop-up"*.

[components/Modal.tsx:48-90](components/Modal.tsx#L48-L90) — o efeito que trava a
rolagem, põe o foco inicial e devolve o foco ao desmontar declarava
`[requestClose]` como dependência. `requestClose` é um `useCallback` que depende
de `confirmClose`, e os **três** modais consumidores passam `confirmClose` como
arrow inline — identidade nova a cada render.

A cadeia, uma tecla por vez:

1. a pessoa digita um caractere → `setName` → `NewUserModal` renderiza de novo;
2. `confirmClose` muda de identidade → `requestClose` muda → o efeito remonta;
3. a limpeza chama `restoreTo.current.focus()` — o foco sai do modal;
4. o corpo do efeito foca `querySelector(FOCUSABLE)`, o **primeiro** focável em
   ordem de documento. No cabeçalho está o `InfoTip`, um `<span tabIndex={0}>`
   que abre o balão no `onFocus`.

Resultado: um caractere por campo, e o pop-up de ajuda por cima do formulário.
Atingia `NewUserModal` (nome, e-mail, senha) e `FixModal` (área de instruções);
o `BatchFixModal` escapava por não ter campo de texto.

**Medido em Chromium** montando o `NewUserModal` real fora do Next (sem banco e
sem autenticação), digitando `"Maria Silva"` tecla a tecla em `#nu-name`:

| Medida | Código original | Corrigido |
|---|---|---|
| Foco ao abrir o modal | `infotip` | `nu-name` |
| Balão de ajuda aberto ao abrir | 1 | 0 |
| O que entrou no campo | `"M"` | `"Maria Silva"` |
| Foco ao terminar de digitar | `infotip` | `nu-name` |
| `body.style.overflow` após fechar | `""` | `""` |
| Erro no console | nenhum | nenhum |

A rolagem **não** vazava, ao contrário do que a primeira leitura deste item
supunha: a limpeza restaura `""` antes de o corpo do efeito recapturar
`prevOverflow`, então o valor guardado nunca chega a ser `"hidden"`. Fica
registrado porque a suposição estava neste documento e foi **refutada pela
medição** — a linha da tabela existe para travar isso.

> ✅ **Corrigido em 28/07/2026.** O efeito foi partido em dois: rolagem, foco
> inicial e restauração ficam num efeito de **montagem** (`[]`), e só o ouvinte
> de teclado reassina em `[requestClose]` — trocar ouvinte não mexe em foco nem
> em rolagem. O foco inicial passou a preferir o primeiro **campo** ao primeiro
> focável, com recuo para o primeiro focável que não seja `InfoTip`: abrir o
> modal já não escancara o balão de ajuda. Suíte `e2e/modal-foco.mjs`.
>
> Nem o tipo nem o lint pegariam isto: `react-hooks/exhaustive-deps` **pedia**
> a dependência que causava o bug. É o terceiro defeito do projeto que só o
> navegador revela, ao lado do `hasFix` e do contador `truncated`.

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

> ✅ **Entregue em 27/07/2026.** `lib/dedup.ts` isomórfico com a regra única; `lib/review.ts` e a tela de resultados importam dela. As duas cópias divergentes sumiram — e a regra unificada é a corrigida pelo BUG-15, não a antiga de nenhum dos dois lados.

### ARQ-12 · Banco atrasado em relação ao código derruba o login com 500 mudo ✅
**P1 · Esforço P**

> ⚠️ **Encontrado em uso real em 27/07/2026**, depois do Sprint 7 — e não por ele.
> O banco estava na migração `0001` enquanto o código já esperava a `0004`.
> Faltavam `users.sessions_invalidated_at` (SEC-02), as tabelas `findings` e
> `finding_fixes` (FEAT-01/02) e `users.locale` (PEND-19). As três migrações
> foram aplicadas; o login voltou. **A causa foi corrigida, o sintoma não.**

- **Evidência:** `authenticate()` chama `ensureSeeded()` antes de procurar o usuário ([lib/auth.ts:88](lib/auth.ts#L88)). O `INSERT` do seed lista todas as colunas do schema Drizzle; uma coluna ausente no banco faz a query estourar, o seed propagar e a rota devolver **500 para qualquer senha** — inclusive a correta.
- **Hoje:** a única pista é `Failed query: insert into "starguard"."users" …` no log do servidor. Quem opera vê "erro na requisição" e não tem como saber que o conserto é `npm run db:migrate`. O `/api/health` existe e **não** confere o schema.
- **Por que é P1:** um banco atrás do código é o estado normal logo depois de um deploy — e o modo de falha escolhido é o pior possível: tudo parece de pé, mas ninguém entra.
- **Como corrigir:**
  1. Na inicialização, comparar as migrações do jornal (`db/migrations/meta/_journal.json`) com as de `drizzle.__drizzle_migrations` e **recusar subir** com uma mensagem dizendo quantas faltam e qual comando roda.
  2. Enquanto isso não existir: `/api/health` reporta `schema: { esperado, aplicado, pendentes[] }` e fica *unhealthy* quando houver diferença.
  3. Falha do seed não pode virar 500 anônimo — envolver o `ensureSeeded()` e responder 503 com "banco desatualizado", que é acionável.
- **Aceite:** subir a app contra um banco uma migração atrás falha na inicialização citando o comando; se subir mesmo assim, o login responde 503 explicando, não 500.

### ARQ-11 · Textos de domínio espalhados como literais ✅
**Esforço M** — a frase-guia de correção está duplicada **literalmente** em [parsers.ts:80](lib/parsers.ts#L80) e [FixModal.tsx:20](components/FixModal.tsx#L20), com uma terceira variante no prompt do agente ([agent-fix.ts:24](lib/agent-fix.ts#L24)). Causa direta de `UX-09`. Centralizar em `lib/constants.ts` — e é pré-requisito do `FEAT-04`.

> ✅ **Entregue em 27/07/2026.** `lib/constants.ts` centraliza a frase-guia de correção e o reconhecimento de sugestão genérica, que estavam duplicados em `parsers.ts`, `FixModal.tsx` e `agent-fix.ts`. É também a base do i18n do FEAT-04.

### ARQ-13 · Orquestrador central e analisadores independentes ✅

**Esforço G.** O fluxo era um **pipeline linear de quatro fases fixas**:
`lib/jobs.ts` rodava `plan → skills → software → refactor` em sequência, sempre
as quatro, sempre na mesma ordem, e `runScan` amarrava SAST, SCA e revisão por
IA dentro de uma fase só — que ainda clonava o repositório para si.

Três consequências, todas medidas no código:

1. **Custo e tempo desnecessários.** Validar uma skill exigia descrever o
   sistema inteiro e esperar a modelagem de ameaças, que é uma chamada de IA.
2. **Quem acha e quem corrige viviam separados.** `generateFix` era uma função
   genérica em `lib/tasks.ts`; `lib/deps-fix.ts` era outro caminho para
   dependência. Acrescentar um analisador significava mexer em três lugares.
3. **Um único consumidor.** Todo o motor tinha `import "server-only"` e vivia
   dentro do app Next. Não havia como rodar aquilo num terminal nem no editor.

> ✅ **Entregue em 04/08/2026.**
>
> **O motor virou pacote.** `packages/core` (`@starguard/core`) — sem Next, sem
> React, sem Drizzle, sem Zod. A fronteira é verificada de duas formas, porque
> esse erro só aparece em runtime: `packages/core/tests/boundary.test.ts` varre
> os imports de todos os arquivos, e `no-restricted-imports` no ESLint reclama
> na hora de escrever.
>
> **Cinco analisadores independentes**, cada um com `probe` (o ambiente
> permite?), `run` e o **corretor embutido** (`Fixer`): `threat`, `sast`, `sca`,
> `business`, `skills`. `threat` e `skills` declaram a ausência de corretor com
> o motivo, em vez de deixá-la implícita.
>
> **O orquestrador** (`packages/core/src/orchestrator.ts`) monta um plano
> **inspecionável antes de rodar** — é a mesma resposta que alimenta o seletor
> da tela, o `starguard doctor` e a árvore do VS Code. Três decisões que valem
> registro:
>
> - **Dependência é enriquecimento, não pré-requisito.** `business` declara
>   `uses: ["threat","sast","sca"]`; se eles não estiverem no plano, ele roda
>   assim mesmo e a degradação é **registrada e dita em voz alta**. Fosse
>   pré-requisito, `--only business` arrastaria o Trivy junto e o pipeline
>   linear voltaria com outro nome.
> - **Paralelo por padrão**, com o workspace aberto **uma vez** e compartilhado
>   (antes o scan clonava para si e a correção clonava outra vez).
> - **Falha de um não derruba os outros** — o isolamento do UX-15 virou regra do
>   orquestrador.
>
> **`propose` separado de `apply`.** `propose` não escreve nada; `apply` é o
> único ponto que grava. É isso que permite o modal do painel, o `--dry-run` do
> terminal e o `vscode.diff` do editor usarem o mesmo código sem risco.
>
> **Três interfaces sobre o mesmo motor**, ligadas por *sinks*:
> `lib/sinks/postgres.ts` (painel), `packages/cli/src/render.ts` (terminal),
> `packages/vscode/src/extension.ts` (diagnósticos). Nenhuma delas sabe
> analisar coisa nenhuma.
>
> **Compatibilidade sem migrar dado.** O painel continua lendo e escrevendo
> `phases: {plan,skills,software,refactor}`; a tradução mora em
> `packages/core/src/compat.ts`. `StepStatus` ganhou `"skipped"` — "não pedi
> isto" não é `pending` nem `error`, e apresentá-lo como qualquer um dos dois
> seria mentir na tela. A coluna `analyses.selected` (migração `0005`) é
> aditiva: linha antiga com `NULL` é lida como "todos", que é o que ela rodou.
>
> **O que ficou de fora, e por quê:** a correção continua **sem gerar nada
> sozinha** (BUG-16) e o `refactor` nasce `skipped`.

**Como o sprint foi validado**

| O que | Como | Resultado **medido** |
|---|---|---|
| Paridade do painel | `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` | 411 testes em 31 arquivos (eram 269 em 22); typecheck limpo nos 4 pacotes; lint com **0 erros** e os mesmos 10 avisos preexistentes; build de produção compila |
| Motor fora do Next | `node -e "import('./packages/core/dist/index.js')"` | Carrega em Node puro e lista os 5 analisadores |
| Terminal, execução real | `node packages/cli/bin/starguard.mjs scan . --only sca --fail-on high` | Trivy real, **20 achados** (9 high, 11 medium) em 24,7 s, **código de saída 1**; com `--fail-on critical`, código 0 |
| Seleção de fato isolada | `starguard scan . --only sca,skills,business` | Só o SCA rodou; os outros quatro saíram **com o motivo** ("Não selecionado", "Precisa de uma chave de IA", "Faltou a entrada") |
| Diagnóstico do ambiente | `starguard doctor` | opengrep 1.25.0 ✔, trivy 0.72.0 ✔, IA ✖ com o motivo; **código de saída 2** |
| Saída sem terminal (CI) | tudo acima rodou com stdout redirecionado | Nenhum código de escape ANSI; só os estados finais, um por analisador |
| Bundle da extensão | `packages/vscode/tests/findings.test.ts` | 423 kB CJS; carrega sob `require` com o módulo `vscode` dublado e expõe `activate`/`deactivate` |
| Extensão empacotada | `vsce package --no-dependencies` | `starguard.vsix` — **125,4 kB, 5 arquivos**: manifesto, README e o bundle. Sem `node_modules`, sem código-fonte |
| Extensão instalada e ATIVADA | `code --install-extension` + `exthost.log` | `starguard.starguard-vscode@0.1.0` instalada; ativação registrada às 05:50:03 por `workspaceContains:.git`, **sem erro subsequente** |
| Migração | `npx drizzle-kit generate` | `0005`: `ALTER TABLE … ADD COLUMN "selected" jsonb` — aditiva, sem reescrever histórico |

**Um bug que só a execução revelou** — e vale registrar porque é exatamente o
padrão que o `CLAUDE.md` descreve.

`starguard skills ./skill.md` mostrava, com um arquivo contendo prompt
injection e exfiltração declaradas:

```
  ✔ Skills e prompts             2  0.0s

  Nenhum achado. 🎉
```

Dois achados reais na linha de cima, "repositório limpo" na de baixo. A causa
era simples: `achadosDe` em `packages/cli/src/render.ts` lia `sast`, `business`
e `sca`, e nunca `skills`. Não quebrava tipo, não quebrava build, não quebrava
teste nenhum — o analisador *rodava* e *contava* certo; só a tabela não o
enxergava. Foi preciso executar o comando.

Corrigido, com `packages/cli/tests/achados.test.ts` (7 asserções) travando as
quatro origens. A execução depois da correção:

```
  ● critical  skill-teste.md:6  prompt-injection   Instrução de sobreposição de política
  ● high      skill-teste.md:6  data-exfiltration  Possível exfiltração de dados/segredos
```

No VS Code a decisão é a **oposta** e está documentada em
`packages/vscode/src/findings.ts`: achado de skill não vai para o painel
Problemas, porque a posição é dentro do texto analisado e pode não corresponder
ao arquivo aberto — fingir uma localização que não se tem é pior que não
mostrar. No terminal a tabela é a única saída, e omitir é esconder.

---

### SEC-11 · IA pela conta, com cota e log de metadado ✅

**Esforço M.** Depois do SEC-10 havia identidade, mas o login não entregava
nada: a extensão e o terminal continuavam exigindo `ANTHROPIC_API_KEY` na
máquina de cada pessoa.

> ✅ **Entregue em 04/08/2026.**
>
> **Dois transportes, escolha explícita.** `local` (chave da máquina, o padrão)
> e `remote` (a chamada vai ao servidor com o token da conta). O remoto **nunca
> liga sozinho**: no terminal exige login, no VS Code exige login **e um
> consentimento modal**. Login é "quem sou eu"; mandar código para fora é outra
> coisa, e merece outra pergunta.
>
> **`/api/ai/complete`** é o único ponto em que o código sai da máquina, e está
> concentrado num arquivo só. A ordem das defesas tem razão: autenticação →
> **cota antes da chamada** (depois seria tarde: a chamada que estoura o teto já
> foi paga) → limite de tamanho → só então o modelo.
>
> **Retenção: metadado, nunca o código.** `ai_usage` guarda quem, para quê, qual
> modelo, quantos tokens e quanto custou. O trecho vive em memória durante a
> chamada e some. Um vazamento deste banco expõe padrão de uso, não o código dos
> clientes — para uma ferramenta que analisa código proprietário, guardar os
> trechos transformaria o servidor no alvo mais valioso da cadeia.
>
> **Teto de US$ 50/conta/mês** (`AI_MONTHLY_BUDGET_USD`). Número escolhido por
> mim na ausência de definição sua: cobre com folga uma pessoa analisando diffs
> em vários repositórios por dia, e corta antes de uma fatura surpreendente.
> **Revise-o** — é a decisão desta entrega que mais depende do seu negócio.
>
> **Custo em milionésimos de dólar, como inteiro.** Somar `0,000042` mil vezes
> em ponto flutuante desvia, e um relatório de cobrança que não fecha é pior que
> não ter relatório.
>
> **402 e não 429** quando a cota acaba: não é "vá mais devagar", é "acabou até o
> mês virar". Repetir não resolve, e o cliente precisa saber para não insistir.

### ARQ-04 · Jobs em memória, sem fila ✅ *(aberto desde a auditoria original)*

**Esforço M.** O disparo era `fire-and-forget`: `/api/analyze` chamava `runJob` e
não esperava. Custo já registrado no BUG-11 (restart deixava a linha em
`running` para sempre) e impedimento absoluto para o webhook — o GitHub espera
resposta em segundos, a análise leva minutos.

> ✅ **Entregue em 04/08/2026.** Fila no **próprio Postgres**, com
> `FOR UPDATE SKIP LOCKED`: várias instâncias pegam jobs diferentes sem
> coordenação externa. Trocar por fila dedicada é decisão de escala, não de
> correção.
>
> - **Deduplicação por consulta**, não por índice único: a regra é "não duplicar
>   entre os NÃO TERMINADOS". Um índice único proibiria para sempre repetir um
>   trabalho igual feito semana passada.
> - **`locked_at` velho volta à fila** — worker morto (deploy no meio do job)
>   não trava a fila. É a doença do BUG-11 resolvida na origem.
> - **`dead` separado de `error`**: job que esgotou tentativas não é
>   reprocessado sozinho, mas também não some. Alguém precisa olhar.
> - **Backoff exponencial** de 1→30 min. Repetir na hora contra serviço fora do
>   ar só gasta tentativa.
>
> **O que a fila NÃO resolve, e continua aberto no ARQ-06:** os segredos do job
> (token do GitHub decifrado, conteúdo das skills) seguem em memória. Job
> retomado por outro processo termina como órfão, com a mensagem explicando.
> Guardá-los em lugar nenhum foi escolha de segurança, não esquecimento.

### SEC-12 · GitHub App: gatilhos automáticos e PR de correções ✅

**Esforço G.** Os dois gatilhos pedidos — PR aberto/atualizado e commit na main
— são eventos que o GitHub **empurra**, e só um App os recebe.

> ✅ **Entregue em 04/08/2026.**
>
> **Por que App, e não token pessoal:** é o único que recebe webhook; o token é
> de instalação, vale **uma hora** e é gerado na hora (nada de token de 30 dias
> no nosso banco); a permissão é por repositório e revogável de lá; e os PRs
> saem como `starguard[bot]`, não no nome de alguém que um dia sai da empresa e
> leva a automação junto.
>
> **A assinatura HMAC é a ÚNICA barreira** da rota (o GitHub não faz login), e
> por isso é a primeira coisa que acontece — antes de parsear, antes de olhar o
> evento. Sobre o **corpo cru**: reserializar o JSON muda espaço e ordem de chave
> e o HMAC deixa de bater. Comparação em **tempo constante**: com `===`, o tempo
> de resposta vaza quantos bytes o atacante acertou.
>
> **Responder rápido, trabalhar depois.** A rota só enfileira e devolve **202**.
> Sem a fila do ARQ-04, este endpoint não poderia existir.
>
> **O que controla a conta do mês:** semgrep e trivy rodam no repositório inteiro
> (rápidos, sem IA); **a correção olha só o que mudou**. Mais um teto de 5
> correções por execução (`WEBHOOK_MAX_FIXES`) e severidade mínima `high` — um PR
> com quarenta correções de IA não é revisado, é aprovado no escuro ou ignorado.
>
> **Decisões de economia que valem registro:** PR em rascunho não é analisado (é
> trabalho inacabado); `push` só na branch padrão (o gatilho de PR já cobre o
> resto); dedupe pelo **SHA** e não pelo número do PR, senão um push novo — que É
> trabalho novo — seria descartado como duplicata.
>
> **As correções são geradas em SEQUÊNCIA**, com `baseCode` encadeado: duas no
> mesmo arquivo partiriam do mesmo original e a última apagaria a primeira, que é
> exatamente o BUG-06.
>
> **O corpo do PR diz que foi gerado por IA e precisa de revisão**, e avisa que o
> lockfile não foi regerado. Um PR automático que se apresenta como veredito
> seria pior que nenhum.

### SEC-13 · Hook de pre-commit ✅

**Esforço P.** O terceiro gatilho.

> ✅ **Entregue em 04/08/2026.** `starguard hook install`.
>
> **Roda só o rápido e local: `--only sast,sca --no-ai`.** Segundos, não minutos.
> Isso é o desenho, não limitação: um hook que segura o commit chamando modelo é
> desinstalado no primeiro dia — o `--no-verify` existe e as pessoas usam. O que
> exige IA acontece no servidor, depois do push.
>
> **Por padrão AVISA e deixa passar.** Bloquear commit é decisão de time:
> `git config starguard.hookBlocks true`.
>
> Duas recusas deliberadas: **não sobrescreve hook de terceiro** (husky,
> lint-staged — apagá-lo em silêncio quebraria o time e o sintoma não apontaria
> para cá) e **respeita `core.hooksPath`** (escrever no lugar errado instala um
> hook que nunca roda: o pior desfecho, porque parece que funcionou).

**Como o sprint foi validado**

| O que | Como | Resultado **medido** |
|---|---|---|
| Suíte | `npm test` | **506 testes** em 38 arquivos (eram 411 em 31 antes do SEC-10) |
| OAuth contra Postgres REAL | `npm run test:live` | **13 testes**, incluindo os dois de atomicidade: 10 resgates simultâneos do mesmo código → **1 vence**; 10 rotações simultâneas do mesmo token → **1 vence** |
| Migrações | `npm run db:migrate` | `0005`–`0008` aplicadas ao banco remoto; **12 tabelas** no schema `starguard`, verificadas por consulta |
| Cota | `tests/ai-quota.test.ts` | 12 asserções: saída custa 5× a entrada, casamento por prefixo (o provedor versiona o id), modelo desconhecido usa fallback **caro** — cobrar a mais é recuperável, deixar de cobrar não |
| Webhook | `tests/github-webhook.test.ts` | 12 asserções, quase todas negativas: segredo errado, corpo alterado num byte, `sha1=` legado, assinatura truncada, e o teste que trava o uso do **corpo cru** |
| Hook | `packages/cli/tests/hook.test.ts` | 11 asserções: **não sobrescreve** hook de terceiro, respeita `core.hooksPath`, e o conteúdo tem mesmo `--only sast,sca --no-ai` |
| Fronteira do núcleo | `boundary.test.ts` | **Pegou um erro real**: `ai-transport.ts` foi escrito com `./types.js` e o teste barrou antes de quebrar o build do painel |
| Build | `npm run build` + `build:packages` | Painel compila com `/api/ai/complete` e `/api/github/webhook`; extensão 439 kB |
| Hook, execução real | `starguard hook install` / `uninstall` | Instalou em `.git/hooks/pre-commit`, executável, e foi **removido depois** — instalar hook é escolha de cada pessoa |

**Três decisões que tomei na sua ausência**, e que você deve revisar:

| Decisão | Valor | Onde mudar |
|---|---|---|
| Teto de IA por conta | **US$ 50/mês** | `AI_MONTHLY_BUDGET_USD` |
| Correções por execução do webhook | **5**, severidade ≥ `high` | `WEBHOOK_MAX_FIXES`, `WEBHOOK_MIN_SEVERITY` |
| Servidor padrão dos clientes | `https://app.starguard.dev` | **inventado por mim** — `STARGUARD_SERVER` / `starguard.server` |

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
