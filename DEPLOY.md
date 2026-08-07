# Deploy — servidor dedicado (Coolify)

Substitui o `render.yaml`, apagado em 07/08/2026. A produção é
`https://starguard.starbridge.com.br`, num servidor dedicado (`sv5`) com
Coolify, recurso do tipo **Dockerfile**.

O que este arquivo é: a lista do que o serviço PRECISA encontrar, e o
procedimento para quando ele não sobe. Não é fonte da verdade do que está no ar
— variável mudada no painel não chega aqui sozinha.

---

## O que mudou ao sair da PaaS

- **`PORT` não é mais injetada pela plataforma.** A imagem traz `3003`; o proxy
  reverso aponta para ela.
- **O TLS é do seu proxy**, não da plataforma.
- **`TRUSTED_PROXY_HOPS`** (padrão `1`) é quantos proxies existem à frente.
  nginx sozinho = 1; nginx + Cloudflare = 2. Errar esse número faz o rate limit
  e o log de auditoria enxergarem o IP errado — o do proxy, igual para todo
  mundo.
- **As migrações não rodam sozinhas.** Ver `RUN_MIGRATIONS` abaixo.

---

## Variáveis

Segredo nenhum mora no repositório: tudo abaixo é definido no painel do
recurso. Quem gera as chaves: `npm run gen:keys`.

### Sem estas o serviço não funciona

| Variável | O que acontece sem ela |
|---|---|
| `DATABASE_URL` | Nada funciona: login, fila e análises falham. Use o **endereço interno** do banco (ver "Rede" abaixo) |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | O entrypoint gera efêmeras e **as sessões caem a cada deploy** |
| `COOKIE_SECRET` | idem |
| `TOKEN_ENC_KEY` | Pior: é a chave AES dos tokens do GitHub gravados no banco. Trocá-la torna **ilegível o que já está cifrado** |
| `AUDIT_IP_SALT` | O log de auditoria perde a capacidade de correlacionar |

### Operação

| Variável | Valor | Por quê |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `3003` | O padrão da imagem; declarada para o proxy não adivinhar |
| `SESSION_SECURE` | `true` | Cookies só por HTTPS |
| `TRUSTED_PROXY_HOPS` | `1` (ou `2` com Cloudflare) | Ver acima |
| `RUN_MIGRATIONS` | `true` | **Sem isto o banco fica vazio** e o login recusa com 503 |
| `QUEUE_WORKER` | `on` | O worker sobe junto com o web. Com worker dedicado, `off` aqui |
| `SAST_RULES` | `/opt/opengrep-rules` | Regras embutidas na imagem; sem isto o SAST baixa do registro remoto a cada análise |

### IA e GitHub App

| Variável | Nota |
|---|---|
| `ANTHROPIC_API_KEY` | A chave do servidor — é ela que atende `/api/ai/complete`, e por isso quem usa a extensão não precisa de chave própria |
| `AI_MONTHLY_BUDGET_USD` | `50` |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | Sem os três, `/api/github/webhook` responde 503 e os gatilhos não existem |
| `WEBHOOK_MAX_FIXES` / `WEBHOOK_MIN_SEVERITY` | `5` / `high` |

### O tamanho da caixa — `AUDITORIA.md#ARQ-15`

**Estes números foram escritos para uma instância de meia CPU e 512 MB de PaaS.
Num servidor dedicado eles são o motivo de o SAST demorar.** Ler a tabela abaixo
como receita foi o que deixou o opengrep escaneando em **um processo só** numa
máquina com vários núcleos ociosos.

Antes de copiar qualquer valor, pergunte à própria instância:

```bash
curl -s https://starguard.starbridge.com.br/api/health | jq .scan
```

> **Incidente confirmado em 07/08/2026:** o host novo tinha 4 GB, mas o recurso
> da aplicação continuava com `memoriaMb: 512`, `memoriaDe: "cgroup"` e
> `cotaDeCpu: 1`. Mover o deploy para outro host não altera automaticamente os
> limites do contêiner. No Coolify, abra os limites de recursos da aplicação,
> remova o teto herdado ou defina **3 GB e pelo menos 2 CPUs** (quando o Postgres
> compartilha o host), salve e **recrie/reimplante** o contêiner. Um simples
> restart conserva o cgroup antigo. Depois, o health deve mostrar cerca de
> `memoriaMb: 3072`, `cotaDeCpu >= 2` e nunca mais `512/1`.

```jsonc
{
  "slots": 1,          // quantos scanners rodam ao mesmo tempo
  "box": {
    "hospedeiro": 8,   // núcleos que o SO enxerga
    "cotaDeCpu": null, // fatia declarada no cgroup (null = sem cota)
    "sastJobs": 1,
    "sastJobsDe": "env" // "env" | "cgroup" | "hospedeiro"  <- a procedência
  }
}
```

`sastJobsDe: "env"` com `hospedeiro: 8` significa que a caixa cresceu e o
trabalho não: alguém (esta tabela) fixou o `1`. `"cgroup"` significa que o
contêiner tem cota — é no Coolify que se muda. `"hospedeiro"` significa que a
máquina é essa mesmo.

**Por que isto importa tanto**, medido com o ruleset já estreitado para
javascript+typescript+generic:

| Onde | Arquivos | `--jobs` | Tempo |
|---|---|---|---|
| Medição histórica no Render, meia CPU | 27 | 1 | 65 s |
| Máquina de desenvolvimento, um núcleo | 268 | 1 | 35 s |

Em produção o custo fica na ordem de **1,3 s por arquivo**. A rota aceita **800
arquivos por scan**, o que dá ≈ **17 minutos com `--jobs 1`**. É isso que o
relato "demora muito e quebra" descreve, e é aritmética, não defeito.

#### Caixa pequena histórica (Render, meia CPU/512 MB) — valores de referência

| Variável | Valor | |
|---|---|---|
| `SAST_JOBS` | `1` | |
| `SAST_MAX_MEMORY_MB` | `200` | |
| `NODE_OPTIONS` | `--max-old-space-size=256` | O Node divide a caixa com dois scanners |

#### Servidor dedicado (o caso atual: 4 GB) — **apague estas variáveis**

Deixe `SAST_JOBS`, `SCAN_SLOTS` e `SAST_MAX_MEMORY_MB` **ausentes**: o código lê
o cgroup e, quando Docker não declara uma cota, usa a
RAM física do host. CPU e memória são dimensionadas juntas: uma vaga de SAST já
contabiliza todos os filhos abertos por `--jobs`, e metade da caixa fica fora do
orçamento dos scanners. Confira em `/api/health` `scan.box.memoriaDe`,
`sastJobsDe`, `scan.slots` e `scan.memory`.

Para a caixa atual de 4 GB, use `NODE_OPTIONS=--max-old-space-size=1280`. Isso
deixa ~2 GB para os scanners, até 1,25 GB de old-space para o V8 e a folga
restante para RSS nativo, buffers e sistema. Ajuste somente depois de observar
`scan.memory.heapUsedMb` e `rssMb`; não volte ao antigo teto de 256 MB.

Se o Postgres divide os mesmos 4 GB físicos, dê ao contêiner da aplicação uma
cota de **3 GB** e use `NODE_OPTIONS=--max-old-space-size=1024`. O código lerá a
cota pelo cgroup e reduzirá sozinho o orçamento agregado dos scanners para
aproximadamente 1,5 GB, deixando 1 GB físico para banco e sistema.

> **`--max-old-space-size=256` numa caixa de 4 GB deixou de ser prudência e
> virou a causa.** Ele não protege memória nenhuma: limita o heap do V8 a 256 MB
> e faz o processo morrer com `JavaScript heap out of memory` enquanto 3,7 GB
> ficam parados. Se preferir declarar um valor em vez de deixar o padrão do
> Node, use o orçamento de `--max-old-space-size=1280` acima.

Se o Coolify impuser cota de CPU ao recurso, é lá que ela sobe — nenhuma
variável daqui contorna um cgroup.

#### Valem para as duas

| Variável | Valor | |
|---|---|---|
| `SCAN_MAX_FILES` | `800` | Teto do que UMA requisição carrega |
| `SCAN_MAX_BYTES` | `8388608` | idem |
| `SAST_TIMEOUT_MS` | `900000` (padrão) | Teto do opengrep. **Tem de caber o que `SCAN_MAX_FILES` autoriza** — era 300 s fixo, e 800 arquivos nunca couberam nele |
| `SCA_TIMEOUT_MS` | `900000` (padrão) | idem, trivy |
| `SCAN_JOB_IDLE_MS` | derivado | Silêncio até dar o job por abandonado. O padrão sai da tolerância do CLIENTE; fixá-lo abaixo dela faz o servidor recolher scans que estão sendo acompanhados |
| `SCAN_JOB_TTL_MS` | `120000` | Fallback para resultado pronto. Clientes atuais enviam um ACK (`DELETE`) assim que consomem e liberam a cópia imediatamente |
| `SCAN_MAX_OUTPUT_MB` | derivado (5% da caixa, entre 8 e 64) | Teto do JSON de resultado. Um JSON de N bytes custa **3 a 4× N** no V8 — é a única coisa deste caminho cujo tamanho não se conhece de antemão |
| `SCAN_MAX_FINDINGS` | `5000` | Achados guardados por scan. Acima disso ficam os mais graves e o corte é dito na tela |
| `SAST_MIN_SERVER_MEMORY_MB` | `1024` | Piso de segurança: abaixo dele o servidor responde 503 antes de iniciar o Opengrep, evitando OOM e permitindo fallback local |
| `SCA_MIN_SERVER_MEMORY_MB` | `768` | Piso equivalente do Trivy; evita que a atualização/carregamento da base derrube o Node |
| `QUEUE_LOCK_HEARTBEAT_MS` / `ANALYSIS_HEARTBEAT_MS` | `30000` | Mantêm lock da fila e `updated_at` vivos durante scanners longos; devem ficar bem abaixo de `QUEUE_LOCK_STALE_MS`/`ANALYSIS_STALE_MS` |

Baixar `SCAN_MAX_FILES` é a alavanca mais direta quando não há CPU a dar: menos
arquivos por scan, dentro do mesmo teto de tempo. O que fica de fora é dito na
tela (`scan.truncated`), nunca some em silêncio.

---

## Rede: o app precisa alcançar o Postgres

**É aqui que o deploy de 07/08/2026 quebrou**, e o sintoma não menciona banco
nenhum — só `503` no healthcheck e `rolling back to the old container`.

No Coolify, cada recurso vai para a sua própria rede Docker. Aplicação e banco
em redes diferentes não se enxergam: o nome do serviço não resolve, ou resolve e
o pacote é descartado. O `pg` reporta os dois casos com a mesma frase —
`Connection terminated due to connection timeout`.

**Confirme antes de mexer** (no host, via SSH):

```bash
docker ps --format '{{.Names}}'          # ache os dois nomes
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' <app> <postgres>
```

Se as duas linhas não tiverem rede em comum, é isto.

**Prove sem redeploy** — junte na mão e pergunte ao próprio app:

```bash
docker network connect <rede-do-postgres> <app>
docker exec -it <app> node scripts/db-doctor.mjs
```

O `db-doctor` responde camada a camada (DNS → TCP → handshake → schema) e diz
qual delas quebrou. Ver o cabeçalho de [`scripts/db-doctor.mjs`](scripts/db-doctor.mjs).

**Conserto permanente**, para sobreviver ao próximo deploy — o `docker network
connect` acima é temporário e some quando o contêiner é recriado:

1. No recurso da aplicação, em *Advanced*, ligue **Connect To Predefined
   Network**. Faça o mesmo no recurso do Postgres.
2. `DATABASE_URL` usa o endereço **interno** que o Coolify mostra na página do
   banco (*Postgres URL (internal)*) — não o público, não `localhost`.
3. Redeploy, e confira com o `db-doctor` de novo.

> `localhost` numa `DATABASE_URL` dentro de contêiner aponta para o **próprio
> contêiner**. Nunca é o que se quer aqui.

---

## Healthcheck: vivacidade, não prontidão

O `HEALTHCHECK` do Dockerfile bate em **`/api/health?probe=live`**, que não toca
no banco e responde 200 enquanto o processo servir HTTP.

Isso é deliberado, e a razão é concreta. `/api/health` (sem parâmetro) responde
por prontidão: **503** enquanto o banco não estiver alcançável e migrado. Como
sinal para quem distribui tráfego, está certo. Como portão do rolling update do
Coolify, prende: contêiner que não fica saudável é revertido, o contêiner velho
tem o mesmo problema — porque o problema não está na imagem — e **enquanto o
banco estiver fora, nenhum deploy entra, nem o que conserta a configuração**.

O mesmo laço fecha em servidor novo com o banco de pé: schema não migrado ⇒ 503
⇒ o primeiro deploy nunca sobe. Daí o `RUN_MIGRATIONS=true` na tabela acima.

Banco fora do ar continua visível — só não derruba mais o deploy:

- `GET /api/health` → `"db": "unreachable"` e a mensagem
- log do boot → uma linha nomeando o `host:porta` que não respondeu
- `starguard doctor`, no terminal

Se apontar o healthcheck de volta para a prontidão, o `--timeout` do
`HEALTHCHECK` tem de ser MAIOR que `HEALTH_TIMEOUT_MS` (8 s). Está fixado em
`tests/health-scanners.test.ts`.

---

## Quando não sobe: por onde começar

```bash
# 1. o processo subiu?
docker logs <app> | grep entrypoint
#    "[entrypoint] StarGuard subindo em 0.0.0.0:3003" = subiu.

# 2. ele alcança o banco?
docker exec -it <app> node scripts/db-doctor.mjs

# 3. o schema existe?
#    O db-doctor responde na etapa 5. Se nunca rodou:
docker exec -it <app> node scripts/migrate.mjs
#    E ponha RUN_MIGRATIONS=true para não repetir isto no próximo deploy.

# 4. o que a prontidão diz, por dentro?
docker exec -it <app> curl -s localhost:3003/api/health | head -40
```

Sintomas e o que significam:

| No log | Significa |
|---|---|
| `worker.loop.failed … connection timeout` | Pacote DESCARTADO: rede errada ou firewall. Não é o Postgres no chão |
| `worker.loop.failed … ECONNREFUSED` | A máquina respondeu: nada escuta nessa porta |
| `Banco INALCANÇÁVEL em host:porta` (no boot) | O mesmo, já com o endereço nomeado |
| `Banco desatualizado: N migração(ões) pendente(s)` | `RUN_MIGRATIONS=true`, ou `node scripts/migrate.mjs` |
| `AVISO: chaves ausentes no ambiente` | Faltam `JWT_*`/`COOKIE_SECRET`/`TOKEN_ENC_KEY`. As sessões vão cair no próximo deploy |

O worker repete o erro com backoff (1×, 2×, 4×… até 1 min) e só registra a 1ª e
as potências de dois. **Se você vê poucas linhas, não quer dizer que passou** —
quer dizer que ele parou de gritar. Ver `lib/worker.ts`.

### "Faltam migrações" com o banco já migrado: são DOIS bancos

O login recusa com *"O banco de dados está desatualizado em relação à
aplicação"* e você tem certeza de ter migrado. Quase sempre são dois bancos
diferentes, e nada na tela pode dizer isso — o app só conhece a
`DATABASE_URL` que recebeu.

O que separa os dois: **a máquina de quem administra alcança o Postgres pela
porta pública** (`177.101.153.200:5430`, por exemplo) e o **contêiner o alcança
pelo endereço interno da rede Docker**. Se esses dois endereços não forem o
mesmo Postgres — ou apontarem para bases diferentes dentro dele — migrar de um
lado não migra o outro, e ambos os lados juram estar certos.

Por isso `migrate.mjs` e `db-doctor.mjs` **imprimem o alvo**, sem credencial:

```bash
# o que o CONTÊINER enxerga
docker exec -it <app> node scripts/db-doctor.mjs | head -3
#   ok   db-abc123:5432/user_starbridge   <- o alvo dele

# o que a SUA máquina enxerga
npm run db:doctor | head -3
#   ok   177.101.153.200:5430/user_starbridge
```

Host diferente com a **mesma base** costuma ser o mesmo Postgres por duas
portas — aí o problema é outro. **Base diferente** (o trecho depois da barra) é a
resposta: são dois bancos.

Seja qual for, o conserto é migrar aquele que o contêiner usa:

```bash
docker exec -it <app> node scripts/migrate.mjs
#   [migrate] schema em dia em db-abc123:5432/user_starbridge.
```

E `RUN_MIGRATIONS=true` no painel, para o próximo deploy fazer isso sozinho. Não
é preciso semear usuários: o seed do `admin@starguard.local` roda sozinho no
primeiro login (`lib/auth.ts`), depois que o schema existe.

> **Migração que falha não derruba mais o contêiner.** Ele sobe, recusa login
> com o texto acionável e deixa o `AVISO` no log — porque um contêiner morto não
> responde `/api/health`, não roda o `db-doctor` e faz o orquestrador reverter o
> deploy. Fixado em `tests/entrypoint-migracoes.test.ts`.

---

## Voltar para uma PaaS, ou subir um ambiente de teste

Todo o necessário está aqui: `runtime: docker` apontando para o `Dockerfile`
(nunca buildpack de Node — ele instala dependências npm e mais nada, e o
resultado é um servidor **sem trivy**, com o scan de dependências rodando,
achando nada e parecendo repositório limpo), `healthCheckPath: /api/health` e a
lista de variáveis acima.
