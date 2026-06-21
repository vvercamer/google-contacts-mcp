#!/usr/bin/env bash
set -euo pipefail
# Start the google-contacts-mcp fork over HTTP with the write guardrail enabled.
# Secrets are read from the macOS Keychain; DRY_RUN=1 by default (no real writes).
# Switch to production with: DRY_RUN=0 ./start-guardrail.sh

cd "$(dirname "$0")"

# Load local, untracked settings (e.g. VAULT_JOURNAL_PATH) if present. See .env.example.
[ -f .env ] && set -a && . ./.env && set +a

export GOOGLE_CLIENT_ID="$(security find-generic-password -a google-contacts-mcp -s GOOGLE_CLIENT_ID -w)"
export GOOGLE_CLIENT_SECRET="$(security find-generic-password -a google-contacts-mcp -s GOOGLE_CLIENT_SECRET -w)"
export MCP_TRANSPORT=http
export PORT="${PORT:-3000}"
export DRY_RUN="${DRY_RUN:-1}"
export VAULT_JOURNAL_PATH="${VAULT_JOURNAL_PATH:-}"

echo "google-contacts-mcp (fork) · DRY_RUN=$DRY_RUN · port=$PORT"
echo "journal: ${VAULT_JOURNAL_PATH:-(unset — set VAULT_JOURNAL_PATH in .env to enable journaling)}"

npm run build
exec node ./dist/main.js
