#!/usr/bin/env bash
# Restores a dump made by backup.sh into a NEW database (BACKUP_PG_DATABASE,
# default ragchat_restored) in the Postgres container. It never touches an
# existing database: docs/deploy.md says how to swap the restored one in.
# BACKUP_PG_CONTAINER comes from the environment, else the repo's .env.
#   scripts/restore.sh /path/to/ragchat-YYYYMMDD-HHMMSS.dump
set -euo pipefail

dump=${1:?usage: restore.sh <dump file>}
[ -f "$dump" ] || { echo "no such dump: $dump" >&2; exit 1; }
env_file=${BACKUP_ENV_FILE:-"$(cd "$(dirname "$0")/.." && pwd -P)/.env"}
container=${BACKUP_PG_CONTAINER:-}
if [ -z "$container" ] && [ -r "$env_file" ]; then
  container=$(grep -E '^BACKUP_PG_CONTAINER=' "$env_file" | tail -n 1 | cut -d= -f2- || true)
fi
container=${container:-ragchat-prod-postgres-1}
database=${BACKUP_PG_DATABASE:-ragchat_restored}

docker exec -i -e DATABASE="$database" "$container" sh -c '
  set -e
  createdb -U "$POSTGRES_USER" "$DATABASE"
  pg_restore -U "$POSTGRES_USER" -d "$DATABASE" --no-owner --exit-on-error' <"$dump"
echo "restored $dump into database $database"
