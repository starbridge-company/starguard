# syntax=docker/dockerfile:1.7
# ============================================================
# StarGuard — imagem de produção (Render ou qualquer host Docker).
#
# Por que NÃO usamos `output: "standalone"`: a Fase 4 usa o Claude Agent SDK,
# que faz spawn de um binário próprio de dentro do node_modules, e `pg`/`argon2`
# têm bindings nativos. Servir com o node_modules real (já sem devDependencies)
# é mais previsível do que confiar no file-tracing do Next para esses pacotes.
#
# Fase 3 precisa de binários no host: git (clone), opengrep (SAST), trivy (SCA).
# Todos ficam na imagem. Sem eles a etapa degrada com mensagem — não quebra o app.
#
#   docker build -t starguard .
#   docker run -p 3000:3000 --env-file .env.local starguard
# ============================================================

ARG NODE_IMAGE=node:22-bookworm-slim
ARG TRIVY_IMAGE=aquasec/trivy:latest

# ---------- Trivy (SCA) — binário oficial, sem curl|sh ----------
FROM ${TRIVY_IMAGE} AS trivy

# ---------- 1. Dependências ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# argon2 traz prebuilds, mas cai para node-gyp quando não há um para a plataforma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# O package-lock.json é artefato da versão do npm que o gerou: o npm 10 que vem
# na imagem resolve a árvore de forma diferente do npm 11 e recusa o lock com
# "can only install packages when package.json and package-lock.json are in
# sync". Fixar a major aqui mantém o build reprodutível.
ARG NPM_VERSION=11
RUN npm i -g npm@${NPM_VERSION} --no-fund \
 && npm ci --no-audit --no-fund

# ---------- 2. Build ----------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# O build não precisa de segredos: config/jwt/crypto/db leem env de forma lazy.
RUN npm run build

# devDependencies fora; os .node já compilados de argon2/pg permanecem.
RUN npm prune --omit=dev

# ---------- 3. Runtime ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# LANG/LC_ALL: o opengrep é Python empacotado e, sem locale UTF-8, lê as regras
# em ASCII e morre com UnicodeDecodeError antes de escanear nada.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOME=/home/node \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# git: clone do repo alvo. tini: PID 1 que reapa os subprocessos de scan.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy

# Opengrep (SAST). Falha aqui é AVISO, não erro: o app degrada sozinho e a
# imagem continua útil com SAST_ENGINE=none.
ARG OPENGREP_VERSION=latest
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) asset="opengrep_manylinux_x86" ;; \
      arm64) asset="opengrep_manylinux_aarch64" ;; \
      *)     asset="" ;; \
    esac; \
    base="https://github.com/opengrep/opengrep/releases"; \
    if [ "$OPENGREP_VERSION" = "latest" ]; then \
      url="$base/latest/download/$asset"; \
    else \
      url="$base/download/$OPENGREP_VERSION/$asset"; \
    fi; \
    if [ -n "$asset" ] && curl -fsSL -o /usr/local/bin/opengrep "$url"; then \
      chmod +x /usr/local/bin/opengrep; \
    else \
      rm -f /usr/local/bin/opengrep; \
      echo "AVISO: opengrep nao instalado (arch=$arch, url=$url) — use SAST_ENGINE=none ou SEMGREP/OPENGREP_BIN."; \
    fi

# Ruleset do SAST embutido: scan offline e determinístico, sem depender do
# registro remoto (rede + SSL) a cada execução. Falhou o clone? Vira AVISO e o
# entrypoint cai para "auto".
#
# O `find` não é zelo estético: UM único YAML inválido no --config aborta o scan
# inteiro (exit 7, zero achados). O repo traz ~60 arquivos que não são regra
# (.pre-commit-config.yaml, stats/*.yml, templates). Filtrar por conteúdo — só
# fica o que tem `rules:` no topo — sobrevive a mudanças do upstream, ao
# contrário de uma lista fixa de exclusões.
#
# ---- Por que o ruleset é RECORTADO ----
#
# O opengrep carrega TODAS as regras do `--config` na memória antes de olhar o
# primeiro arquivo. O repositório completo traz dezenas de linguagens que este
# produto não escaneia (elixir, ocaml, swift, clojure, terraform…) e categorias
# que não são segurança (best-practice, correctness, performance). Numa
# instância de 512 MB isso é a diferença entre escanear e ser morto pelo kernel:
# o processo estourava a memória e derrubava o SERVIDOR junto, não só o scan.
# Ver AUDITORIA.md#ARQ-15.
#
# `OPENGREP_LANGS` é o recorte, e é sobrescritível no build para quem hospeda
# numa caixa maior ou escaneia outra pilha.
ARG OPENGREP_RULES_REF=main
ARG OPENGREP_LANGS="javascript typescript python java go php ruby csharp c generic html"
RUN set -eu; \
    if git clone --depth 1 --branch "$OPENGREP_RULES_REF" \
         https://github.com/opengrep/opengrep-rules.git /opt/opengrep-rules; then \
      rm -rf /opt/opengrep-rules/.git /opt/opengrep-rules/.github; \
      # 1. Fora as linguagens que não escaneamos.
      for dir in /opt/opengrep-rules/*/; do \
        nome="$(basename "$dir")"; \
        manter=0; \
        for lang in $OPENGREP_LANGS; do [ "$nome" = "$lang" ] && manter=1; done; \
        [ "$manter" = "1" ] || rm -rf "$dir"; \
      done; \
      # 2. Fora o que não é regra de SEGURANÇA. O `find` não é zelo estético:
      #    UM único YAML inválido no --config aborta o scan inteiro (exit 7,
      #    zero achados). Filtrar por CONTEÚDO — só fica o que tem `rules:` no
      #    topo — sobrevive a mudanças do upstream, ao contrário de uma lista
      #    fixa de exclusões.
      find /opt/opengrep-rules -type d \
        \( -name 'best-practice' -o -name 'correctness' -o -name 'performance' \
           -o -name 'maintainability' -o -name 'portability' \) -prune -exec rm -rf {} +; \
      find /opt/opengrep-rules -type f \( -name '*.yaml' -o -name '*.yml' \) \
        ! -exec grep -qE '^rules:' {} \; -delete; \
      echo "regras validas: $(find /opt/opengrep-rules -name '*.y*ml' | wc -l)"; \
      echo "tamanho do ruleset: $(du -sh /opt/opengrep-rules | cut -f1)"; \
    else \
      rm -rf /opt/opengrep-rules; \
      echo "AVISO: opengrep-rules nao clonado — SAST usara o registro remoto (auto)."; \
    fi
ENV SAST_RULES=/opt/opengrep-rules

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/db/migrations ./db/migrations
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# O código fica root-only: o usuário da aplicação só escreve onde precisa —
# .env.local (chaves geradas no boot) e o cache de runtime do Next.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && touch /app/.env.local \
 && chown node:node /app/.env.local \
 && chmod 600 /app/.env.local \
 && mkdir -p /app/.next/cache /home/node/.cache \
 && chown -R node:node /app/.next/cache /home/node

USER node

# Pré-aquece o opengrep JÁ COMO `node`: ele se auto-extrai em $HOME/.cache na 1ª
# execução (214 MB), o que fora do build cairia dentro do timeout de 300s do
# execFile. Rodar isto antes do USER node custaria a mesma coisa duas vezes —
# uma na extração como root, outra no chown para node.
#
# A base do Trivy NÃO é pré-carregada de propósito: são 1.2 GB em disco que ele
# considera vencida em ~6h e rebaixa no primeiro scan de qualquer forma.
RUN command -v opengrep >/dev/null 2>&1 && opengrep --version >/dev/null 2>&1 \
      || echo "AVISO: opengrep indisponivel — SAST cai em erro explicativo em runtime."

EXPOSE 3000

# Clones descartáveis da Fase 3/4 vão para o tmpdir do SO.
ENV TMPDIR=/tmp

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
