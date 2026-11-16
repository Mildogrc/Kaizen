#!/usr/bin/env bash
# One-time copy of this Mac's Kaizen database into the new (empty) hosted
# Postgres. Run it BEFORE the site is visited for the first time: the server
# creates its tables on first start, and the copy needs an empty database.
# Your local database is only read.
set -euo pipefail
cd "$(dirname "$0")/../.."

LOCAL_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
[ -n "$LOCAL_URL" ] || { echo "DATABASE_URL not found in .env" >&2; exit 1; }

read -r -s -p "Neon connection string (input hidden): " NEON_URL
echo
case "$NEON_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "That doesn't look like a Postgres connection string." >&2; exit 1 ;;
esac

tables=$(psql "$NEON_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "The hosted database already has $tables tables. Refusing to copy over it." >&2
  exit 1
fi

echo "Copying (about 25 MB)..."
pg_dump --no-owner --no-privileges --format=plain "$LOCAL_URL" | psql -v ON_ERROR_STOP=1 -q "$NEON_URL" >/dev/null
users=$(psql "$NEON_URL" -Atc "SELECT count(*) FROM users")
reviews=$(psql "$NEON_URL" -Atc "SELECT count(*) FROM anki_review_logs" 2>/dev/null || echo "?")
echo "Done: $users user(s), $reviews Anki review logs in the hosted database."
