#!/usr/bin/env bash
# Daily backup of the knowledge base (docs/deploy.md): a pg_dump of the database
# into BACKUP_DIR. pg_dump runs inside the Postgres container, so the host needs
# no Postgres client and the versions always match.
#
# Settings come from the environment, else from the repo's .env (BACKUP_ENV_FILE):
#   BACKUP_DIR           where dumps go; recommended on another disk. Required.
#   BACKUP_PG_CONTAINER  the Postgres container (default ragchat-prod-postgres-1)
#   BACKUP_PG_DATABASE   the database (default: the container's POSTGRES_DB)
#   BACKUP_RCLONE_REMOTE an rclone remote (e.g. offsite:ragchat) each dump is also
#                        copied to; skipped when unset
# Dumps older than 14 days are deleted, in BACKUP_DIR and on the remote.
#
# The dump holds pseudonyms only (ADR-0004); the key that turns them back into
# real values must never sit beside it, so a BACKUP_DIR that holds the .env or
# the key is refused.
set -euo pipefail

env_file=${BACKUP_ENV_FILE:-"$(cd "$(dirname "$0")/.." && pwd -P)/.env"}

# One key from the .env file, without sourcing it (the file is not a script).
from_env_file() {
  [ -r "$env_file" ] || return 0
  grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']$//" || true
}

BACKUP_DIR=${BACKUP_DIR:-$(from_env_file BACKUP_DIR)}
container=${BACKUP_PG_CONTAINER:-$(from_env_file BACKUP_PG_CONTAINER)}
container=${container:-ragchat-prod-postgres-1}
database=${BACKUP_PG_DATABASE:-}
remote=${BACKUP_RCLONE_REMOTE:-$(from_env_file BACKUP_RCLONE_REMOTE)}
retention_days=14

fail() {
  echo "backup.sh: $*" >&2
  exit 1
}

[ -n "$BACKUP_DIR" ] || fail "BACKUP_DIR is not set"
[ -d "$BACKUP_DIR" ] || fail "BACKUP_DIR $BACKUP_DIR is not a directory"
dir=$(cd "$BACKUP_DIR" && pwd -P)

# Never next to the encryption key: not the .env (or a directory holding it),
# not any file that contains the key.
key_refusal="refusing to back up into $dir: it holds the encryption key (PSEUDONYM_ENCRYPTION_KEY); use a directory apart from the .env"
if [ -n "$(find "$dir" -maxdepth 3 -name '.env*' -print -quit 2>/dev/null)" ]; then
  fail "$key_refusal"
fi
if [ -e "$env_file" ] && [ "$env_file" != /dev/null ]; then
  env_dir=$(cd "$(dirname "$env_file")" && pwd -P)
  case "$env_dir/" in "$dir"/*) fail "$key_refusal" ;; esac
fi
key=${PSEUDONYM_ENCRYPTION_KEY:-$(from_env_file PSEUDONYM_ENCRYPTION_KEY)}
if [ -n "$key" ] && grep -rqsF --exclude='*.dump' -- "$key" "$dir"; then
  fail "$key_refusal"
fi

umask 077
name="ragchat-$(date -u +%Y%m%d-%H%M%S).dump"
partial="$dir/.$name.partial"
trap 'rm -f "$partial"' EXIT
docker exec -e DATABASE="$database" "$container" \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "${DATABASE:-$POSTGRES_DB}" --format=custom' >"$partial"
mv "$partial" "$dir/$name"
echo "backup.sh: wrote $dir/$name"

find "$dir" -maxdepth 1 -type f -name 'ragchat-*.dump' -mmin +$((retention_days * 24 * 60)) -print -delete |
  sed 's/^/backup.sh: deleted old dump /'

if [ -n "$remote" ]; then
  rclone copy "$dir/$name" "$remote"
  rclone delete "$remote" --min-age "${retention_days}d" --include 'ragchat-*.dump'
  echo "backup.sh: copied to $remote"
fi
