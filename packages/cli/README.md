# `starguard` — StarGuard no terminal

O mesmo motor do painel web, sem servidor e sem banco. Os analisadores são os
mesmos objetos e a correção sai do corretor embutido em cada um.

## Comandos

```bash
starguard scan [alvo]        # alvo = diretório (padrão: .) ou URL do GitHub
starguard skills <arquivos>  # valida skills — não precisa de repositório
starguard fix [ids]          # propõe correção; sem id, corrige o mais grave
starguard doctor             # o que está instalado e configurado
starguard list               # os analisadores e o que cada um faz
```

## Escolher o que roda

Esta é a razão de existir do comando. Cada analisador é independente:

```bash
starguard scan . --only sca            # só as dependências (Trivy)
starguard scan . --only sast           # só o código (Opengrep/Semgrep)
starguard scan . --only business       # só as regras de negócio (IA)
starguard scan . --skip business       # tudo menos as regras de negócio
starguard skills ./skill.md            # atalho para --only skills
```

Analisador que não pode rodar **não some da saída**: aparece com o motivo.

```
  – Modelagem de ameaças         Não selecionado nesta execução.
  – Regras de negócio            Precisa de uma chave de IA e nenhuma foi configurada.
  ✔ Dependências vulneráveis     20  24.7s
```

## Em CI

```bash
starguard scan . --only sast,sca --fail-on high --sarif starguard.sarif
```

| Código de saída | Significa |
|---|---|
| `0` | Nada acima do limiar de `--fail-on` |
| `1` | Achado atingiu o limiar. **Não é falha da ferramenta — é o trabalho dela.** |
| `2` | A execução falhou: uso errado, repositório inacessível, binário ausente |

Sem terminal interativo (pipe, redirecionamento, `CI=1`, `NO_COLOR=1`) a saída
vira linhas sequenciais, uma por analisador, **sem nenhum código de escape**.
Um log de CI cheio de `\x1b[2K` é ilegível, e um `--json` com cor no meio deixa
de ser JSON.

## Correção

```bash
starguard fix                          # o achado mais grave, em simulação
starguard fix F-12 --write             # um achado específico, gravando
starguard fix --all --severity high    # tudo a partir de high
```

**Simular é o padrão.** Gravar no código de alguém sem pedir seria a última
coisa que uma ferramenta de segurança deveria fazer — `--write` é explícito.

## Conta

```bash
starguard login    # abre o navegador; a senha é digitada LÁ, nunca aqui
starguard whoami   # quem está conectado
starguard logout   # remove a credencial deste computador
```

O login usa **OAuth 2.0 Authorization Code + PKCE**. O terminal nunca vê a sua
senha: recebe um código que, sem o `code_verifier` que ele mesmo sorteou, não
vale nada. Não há segredo embutido no pacote — não haveria como guardá-lo, já
que o código é legível por quem o instala.

A credencial fica em `~/.starguard/credentials.json` com permissão `0600`, e
guarda **só o refresh token** (o access dura 15 min e fica em memória).

Cada uso **rotaciona** o refresh. Se um token já rotacionado for apresentado de
novo — o que acontece se alguém copiar o arquivo —, a sessão inteira cai e o
evento vai para a trilha de auditoria. É o incômodo que torna o roubo
detectável.

`starguard logout` apaga a credencial **local**. A sessão no servidor segue até
expirar: para encerrá-la, revogue em **Conta → Dispositivos conectados**.

> **CI não faz login de pessoa.** Servidor não tem navegador, e um refresh token
> guardado numa variável de CI é exatamente o que a rotação existe para
> detectar. Use o GitHub App.

## Configuração

Precedência: **flag > variável de ambiente > `.starguard.json` > padrão.**

```json
{
  "select": ["sast", "sca"],
  "failOn": "high",
  "locale": "pt-BR"
}
```

| Variável | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | regras de negócio, modelagem de ameaças e correção |
| `STARGUARD_SERVER` | servidor de autenticação (quem auto-hospeda) |
| `STARGUARD_CREDENTIALS` | caminho do arquivo de credencial |
| `GITHUB_TOKEN` | repositório privado (ou `--token`) |
| `SEMGREP_BIN` · `OPENGREP_BIN` · `TRIVY_BIN` | caminho dos executáveis |
| `SAST_RULES` | diretório de regras local — roda o SAST **offline** |

Chave de IA **nunca** vai no `.starguard.json`: esse arquivo é versionado.

## Idioma

`--lang pt-BR|en|es`. É o mesmo dicionário do painel e da extensão — um idioma
novo vale nos três de uma vez.
