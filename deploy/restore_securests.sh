#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/securests/backend.env"
SERVICE_NAME="securests-backend"
DB_BACKUP=""
MEDIA_BACKUP=""
RESTORE_MEDIA=false
SKIP_SERVICE_RESTART=false
FORCE=false

usage() {
  cat <<'EOF'
Usage:
  restore_securests.sh --db-backup PATH [--media-backup PATH] [--restore-media] [--force] [--env-file PATH] [--service-name NAME] [--skip-service-restart]

Examples:
  ./restore_securests.sh --db-backup /srv/securests/backups/prod/20260305T020000Z/postgres.dump --force
  ./restore_securests.sh --db-backup /srv/securests/backups/prod/20260305T020000Z/postgres.dump --media-backup /srv/securests/backups/prod/20260305T020000Z/media.tar.gz --restore-media --force
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-backup)
      DB_BACKUP="$2"
      shift 2
      ;;
    --media-backup)
      MEDIA_BACKUP="$2"
      shift 2
      ;;
    --restore-media)
      RESTORE_MEDIA=true
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --skip-service-restart)
      SKIP_SERVICE_RESTART=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$DB_BACKUP" ]]; then
  echo "--db-backup is required." >&2
  usage
  exit 1
fi

if [[ "$FORCE" != "true" ]]; then
  echo "Refusing to restore without --force (destructive operation)." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$DB_BACKUP" ]]; then
  echo "DB backup file not found: $DB_BACKUP" >&2
  exit 1
fi

if [[ "$RESTORE_MEDIA" == "true" && -n "$MEDIA_BACKUP" && ! -f "$MEDIA_BACKUP" ]]; then
  echo "Media backup file not found: $MEDIA_BACKUP" >&2
  exit 1
fi

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

load_env_file "$ENV_FILE"

: "${DB_NAME:?DB_NAME is required in $ENV_FILE}"
: "${DB_USER:?DB_USER is required in $ENV_FILE}"
: "${DB_HOST:?DB_HOST is required in $ENV_FILE}"
: "${DB_PORT:?DB_PORT is required in $ENV_FILE}"
: "${DB_PASSWORD:?DB_PASSWORD is required in $ENV_FILE}"

MEDIA_ROOT_DEFAULT="/srv/securests/app/backend/media"
MEDIA_DIR="${MEDIA_ROOT:-$MEDIA_ROOT_DEFAULT}"

if [[ "$SKIP_SERVICE_RESTART" != "true" ]]; then
  sudo systemctl stop "$SERVICE_NAME"
fi

export PGPASSWORD="$DB_PASSWORD"

# Drop and recreate schema to avoid stale objects.
psql \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --set=ON_ERROR_STOP=1 \
  --command="DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  "$DB_BACKUP"

if [[ "$RESTORE_MEDIA" == "true" ]]; then
  if [[ -z "$MEDIA_BACKUP" ]]; then
    echo "--restore-media was provided but --media-backup is missing." >&2
    exit 1
  fi
  mkdir -p "$MEDIA_DIR"
  rm -rf "${MEDIA_DIR:?}/"*
  tar -xzf "$MEDIA_BACKUP" -C "$MEDIA_DIR"
fi

if [[ "$SKIP_SERVICE_RESTART" != "true" ]]; then
  sudo systemctl start "$SERVICE_NAME"
fi

echo "Restore completed successfully."
