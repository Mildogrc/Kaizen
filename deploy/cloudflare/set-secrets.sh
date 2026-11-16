#!/usr/bin/env bash
# Store the Worker's secrets in Cloudflare. Values go straight from this
# Mac's files or a hidden prompt into Wrangler; nothing is printed or saved.
# Run after the first `npx wrangler deploy` (the Worker must exist).
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..

from_env() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2- || true; }
put() {
  if [ -z "$2" ]; then echo "  - $1 skipped (empty)"; return; fi
  printf '%s' "$2" | npx wrangler secret put "$1" >/dev/null && echo "  ✓ $1"
}
ask() {
  local value
  read -r -s -p "$2: " value
  echo
  put "$1" "$value"
}

echo "Reusing values from this Mac:"
# Same key as the local install, so the encrypted API keys and ChatGPT tokens
# copied with your data stay readable.
put KAIZEN_SECRET_KEY "$(cat "$HOME/.config/kaizen/secret.key")"
put KAIZEN_OWNER_EMAIL "$(from_env KAIZEN_OWNER_EMAIL)"
put AUTH_GOOGLE_CLIENT_ID "$(from_env AUTH_GOOGLE_CLIENT_ID)"
put AUTH_GOOGLE_CLIENT_SECRET "$(from_env AUTH_GOOGLE_CLIENT_SECRET)"

echo
echo "Paste each value (input is hidden; press Enter to skip optional ones):"
ask DATABASE_URL "Neon connection string"
ask ANTHROPIC_API_KEY "Anthropic API key (pays for verified students' free AI)"
ask YOUTUBE_API_KEY "YouTube Data API key (optional)"
echo
echo "Secrets saved. Cloudflare redeploys the Worker automatically."
