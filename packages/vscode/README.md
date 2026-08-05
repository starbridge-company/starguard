# StarGuard para VS Code

Análise de segurança dentro do editor. A extensão roda `@starguard/core` **no
extension host** — mesmo processo, sem servidor e sem banco. O código não sai da
máquina, e por isso funciona em projeto que ainda não foi enviado para lugar
nenhum.

## O que ela faz

- **Árvore lateral** com um item por analisador, o estado de cada um e um ▶ para
  rodar só aquele. Indisponível aparece com o motivo no tooltip, não some.
- **Painel Problemas**: cada achado vira um diagnóstico com `source:
  starguard/<analisador>` — dá para filtrar e ver só as dependências, por
  exemplo. O código da regra leva ao CWE quando há um.
- **Lâmpada (Quick Fix)**: `StarGuard: corrigir com IA` abre o **diff antes de
  gravar**. Nada é escrito até você confirmar — é a separação `propose`/`apply`
  do motor chegando à interface.

Uma coleção de diagnósticos **por analisador**: rodar só o Trivy não apaga os
achados do Semgrep da execução anterior.

## Conta

A conta aparece no **menu Contas** do VS Code, ao lado do GitHub — e sai de lá
também. Quem já sabe desconectar o GitHub sabe desconectar o StarGuard.

O login é **OAuth 2.0 Authorization Code + PKCE**: abre o navegador, você entra
na tela do StarGuard, e o editor recebe de volta um código que só vale junto do
verificador que ele mesmo sorteou. **A senha nunca é digitada dentro do
editor.** O token fica no `SecretStorage` (chaveiro do sistema operacional),
nunca em `settings.json` — aquele arquivo é versionado em muitos projetos.

Funciona em **Remote SSH e Codespaces**: o retorno passa por
`vscode.env.asExternalUri`, então não depende de um servidor local alcançável.

Para encerrar a sessão no servidor (e não só neste editor), revogue o
dispositivo em **Conta → Dispositivos conectados** no painel.

## Comandos

| Comando | O que faz |
|---|---|
| `StarGuard: analisar tudo` | roda os de `starguard.analyzers.enabled` |
| `StarGuard: analisar…` | escolhe um da lista |
| `StarGuard: validar a skill aberta` | o arquivo do editor é a skill |
| `StarGuard: diagnóstico` | o que está instalado e configurado |
| `StarGuard: definir a chave de IA` | guarda no **SecretStorage** |
| `StarGuard: entrar na conta` | login pelo navegador (OAuth PKCE) |
| `StarGuard: sair da conta` | remove a credencial deste editor |

## Configuração

| Chave | Padrão | Para quê |
|---|---|---|
| `starguard.analyzers.enabled` | `["sast","sca"]` | o que "analisar tudo" roda |
| `starguard.semgrepPath` · `starguard.trivyPath` | PATH | caminho dos executáveis |
| `starguard.locale` | `pt-BR` | idioma dos achados |
| `starguard.server` | app.starguard.dev | servidor de autenticação |
| `starguard.systemDescription` | — | usada por **regras de negócio** e modelagem |

O padrão traz só os dois analisadores que **não custam IA**; os outros continuam
disponíveis um a um pela árvore. A chave de IA vive no `SecretStorage`, nunca em
`settings.json` — aquele arquivo é versionado em muitos projetos.

## Instalar

### A partir do repositório (é o que existe hoje)

```bash
npm run build:packages                  # núcleo → CLI → extensão
npm run package -w starguard-vscode     # gera packages/vscode/starguard.vsix
code --install-extension packages/vscode/starguard.vsix
```

Depois, **Recarregar janela** (`Ctrl+Shift+P` → *Developer: Reload Window*).

O `.vsix` é um arquivo só, de ~125 kB: dá para anexar num release do GitHub, num
canal interno ou mandar por e-mail. Quem recebe instala pelo comando acima ou
pela paleta: `Extensions: Install from VSIX…`.

### Pela Marketplace da Microsoft

Só falta a conta — o pacote já está pronto:

1. Criar uma organização no [Azure DevOps](https://dev.azure.com) e um **PAT**
   com escopo *Marketplace → Manage*.
2. Criar o publisher em <https://marketplace.visualstudio.com/manage> e trocar
   `"publisher": "starguard"` no `package.json` pelo id real.
3. `npx vsce login <publisher>` e `npm run publish:marketplace -w starguard-vscode`.

Antes de publicar: um `LICENSE` no diretório (o `vsce` avisa que falta) e um
`icon.png` de 128×128, que é o que aparece na listagem.

### Pela Open VSX (VSCodium, Cursor, Gitpod)

A Marketplace da Microsoft só serve o VS Code oficial. Para os outros:
`npx ovsx publish starguard.vsix -p <token>`.

## Desenvolvimento

```bash
npm run build:dev -w starguard-vscode   # bundle com sourcemap
```

`F5` abre o Extension Development Host.

O empacotamento é CommonJS: o extension host carrega a extensão via `require` e
`@starguard/core` é ESM puro — a conversão é o que permite os dois se falarem.
`esbuild` e o próprio `@starguard/core` são dependências de **desenvolvimento**:
o motor é embutido no bundle, então o `.vsix` não leva `node_modules` nenhum.

## Estado

> ⚠️ **A interface ainda não foi usada** — ver `AUDITORIA.md#PEND-33`.
>
> O que está verificado: o `.vsix` é gerado, instala, e a extensão **ativa no
> editor real** (`exthost.log` registra a ativação por `workspaceContains:.git`,
> sem erro). O que não está: a árvore desenhada, o ▶ por analisador, o
> sublinhado no painel Problemas, a lâmpada e o diff. Instalar e ativar não é o
> mesmo que funcionar na mão de alguém.
