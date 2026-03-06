#!/usr/bin/env bash
set -euo pipefail

load_env_file() {
  local file="$1"
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line="$raw_line"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(printf '%s' "$key" | xargs)"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done < "$file"
}

CONFIG_FILE="${CONFIG_FILE:-/etc/securests/backup-ops.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  load_env_file "$CONFIG_FILE"
fi

ENV_FILE="${ENV_FILE:-/etc/securests/backend.env}"
OUT_DIR="${OUT_DIR:-/srv/securests/backups/prod}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-36}"
RESTORE_TEST_ENABLED="${RESTORE_TEST_ENABLED:-true}"
RESTORE_TEST_TIMEOUT_SECONDS="${RESTORE_TEST_TIMEOUT_SECONDS:-600}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

load_env_file "$ENV_FILE"

: "${DB_NAME:?DB_NAME is required in $ENV_FILE}"
: "${DB_USER:?DB_USER is required in $ENV_FILE}"
: "${DB_HOST:?DB_HOST is required in $ENV_FILE}"
: "${DB_PORT:?DB_PORT is required in $ENV_FILE}"
: "${DB_PASSWORD:?DB_PASSWORD is required in $ENV_FILE}"

latest_dir="$(find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
if [[ -z "${latest_dir:-}" || ! -d "$latest_dir" ]]; then
  echo "No backup directories found in $OUT_DIR" >&2
  exit 1
fi

db_dump="$latest_dir/postgres.dump"
if [[ ! -f "$db_dump" ]]; then
  echo "Missing DB backup: $db_dump" >&2
  exit 1
fi

if [[ ! -f "$latest_dir/SHA256SUMS" ]]; then
  echo "Missing checksum file: $latest_dir/SHA256SUMS" >&2
  exit 1
fi

backup_mtime_epoch="$(stat -c %Y "$latest_dir")"
now_epoch="$(date +%s)"
age_hours="$(( (now_epoch - backup_mtime_epoch) / 3600 ))"
if (( age_hours > MAX_BACKUP_AGE_HOURS )); then
  echo "Latest backup is too old: ${age_hours}h (max ${MAX_BACKUP_AGE_HOURS}h)." >&2
  exit 1
fi

(cd "$latest_dir" && sha256sum -c SHA256SUMS >/dev/null)
pg_restore --list "$db_dump" >/dev/null

if [[ "$RESTORE_TEST_ENABLED" != "true" ]]; then
  echo "Restore check completed (checksum + pg_restore --list only)."
  exit 0
fi

tmp_db="${DB_NAME}_restore_check_$(date +%s)"
export PGPASSWORD="$DB_PASSWORD"

cleanup() {
  dropdb \
    --if-exists \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    "$tmp_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

createdb \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  "$tmp_db"

timeout "$RESTORE_TEST_TIMEOUT_SECONDS" pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$tmp_db" \
  "$db_dump"

migrations_count="$(
  psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$tmp_db" \
    --tuples-only --no-align \
    --command='select count(*) from django_migrations;' | tr -d '[:space:]'
)"

if [[ -z "$migrations_count" || "$migrations_count" == "0" ]]; then
  echo "Restore test failed: django_migrations count is empty/zero." >&2
  exit 1
fi

echo "Restore check completed: backup_dir=$latest_dir migrations=$migrations_count"
