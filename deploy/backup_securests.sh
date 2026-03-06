#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/securests/backend.env"
OUT_DIR="/srv/securests/backups/prod"
RETENTION_DAYS=14
SKIP_MEDIA=false

usage() {
  cat <<'EOF'
Usage:
  backup_securests.sh [--env-file PATH] [--out-dir PATH] [--retention-days N] [--skip-media]

Examples:
  ./backup_securests.sh
  ./backup_securests.sh --retention-days 30
  ./backup_securests.sh --out-dir /srv/securests/backups/staging --skip-media
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --retention-days)
      RETENTION_DAYS="$2"
      shift 2
      ;;
    --skip-media)
      SKIP_MEDIA=true
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

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
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

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET_DIR="$OUT_DIR/$TIMESTAMP"
mkdir -p "$TARGET_DIR"

export PGPASSWORD="$DB_PASSWORD"
DB_BACKUP="$TARGET_DIR/postgres.dump"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --file="$DB_BACKUP"

MEDIA_ROOT_DEFAULT="/srv/securests/app/backend/media"
MEDIA_DIR="${MEDIA_ROOT:-$MEDIA_ROOT_DEFAULT}"
if [[ "$SKIP_MEDIA" != "true" && -d "$MEDIA_DIR" ]]; then
  tar -czf "$TARGET_DIR/media.tar.gz" -C "$MEDIA_DIR" .
fi

sha256sum "$TARGET_DIR"/* > "$TARGET_DIR/SHA256SUMS"

cat > "$TARGET_DIR/metadata.txt" <<EOF
timestamp_utc=$TIMESTAMP
db_name=$DB_NAME
db_host=$DB_HOST
db_port=$DB_PORT
media_dir=$MEDIA_DIR
skip_media=$SKIP_MEDIA
EOF

find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

echo "Backup completed: $TARGET_DIR"
