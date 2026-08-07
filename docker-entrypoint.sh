#!/bin/sh
# ============================================================
# Boot do container: chaves -> migrações/seed (opcionais) -> next start.
# Roda como PID filho do tini; o `exec` final entrega os sinais ao Next.
# ============================================================
set -e

: "${PORT:=3003}"

# ---- 1. Chaves ----
# Em produção defina JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, COOKIE_SECRET e
# TOKEN_ENC_KEY como variáveis de ambiente. Geradas aqui, elas mudam a cada
# deploy: as sessões caem e — pior — os tokens do GitHub cifrados no banco
# ficam ilegíveis, porque TOKEN_ENC_KEY é a chave AES que os decifra.
if [ -z "${JWT_PRIVATE_KEY:-}" ] || [ -z "${JWT_PUBLIC_KEY:-}" ] \
   || [ -z "${COOKIE_SECRET:-}" ] || [ -z "${TOKEN_ENC_KEY:-}" ]; then
  echo "[entrypoint] AVISO: chaves ausentes no ambiente — gerando efêmeras (perdidas no próximo deploy)."
  node scripts/gen-keys.mjs
fi

# ---- 2. Caminhos de máquina local ----
# Valores como OPENGREP_BIN=C:\Users\...\opengrep.exe vazam do .env.local para o
# painel do host com facilidade. Aqui eles são descartados em vez de quebrarem
# o scan: sem a env, o app volta ao default (binário do PATH, ruleset embutido).
# printf, não echo: caminhos Windows têm \b e \t, que o echo do dash come.
for var in OPENGREP_BIN SEMGREP_BIN TRIVY_BIN; do
  eval "val=\${$var:-}"
  if [ -n "$val" ] && ! command -v "$val" >/dev/null 2>&1; then
    printf '[entrypoint] AVISO: %s=%s não existe no container — ignorando (usando o PATH).\n' "$var" "$val"
    unset "$var"
  fi
done

BUNDLED_RULES=/opt/opengrep-rules
if [ -n "${SAST_RULES:-}" ] && [ ! -e "${SAST_RULES}" ]; then
  if [ -d "$BUNDLED_RULES" ]; then
    printf '[entrypoint] AVISO: SAST_RULES=%s não existe no container — usando o ruleset embutido (%s).\n' "$SAST_RULES" "$BUNDLED_RULES"
    SAST_RULES="$BUNDLED_RULES"
    export SAST_RULES
  else
    printf '[entrypoint] AVISO: SAST_RULES=%s não existe no container — usando o registro remoto (auto).\n' "$SAST_RULES"
    unset SAST_RULES
  fi
fi

# ---- 3. Banco (opt-in por env) ----
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] aplicando migrações..."
  node scripts/migrate.mjs
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] semeando usuários iniciais..."
  node scripts/seed.mjs
fi

# ---- 4. App ----
echo "[entrypoint] StarGuard subindo em 0.0.0.0:${PORT}"
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "$PORT"
