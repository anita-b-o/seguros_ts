#!/usr/bin/env bash
set -euo pipefail

# Build frontend using a dedicated production env file.
# Default env source: /etc/segurosts/frontend.env.production

ENV_FILE="${1:-/etc/segurosts/frontend.env.production}"
FRONTEND_DIR="${FRONTEND_DIR:-/var/www/segurosts/app/frontend}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] Env file not found: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "[ERROR] Frontend directory not found: $FRONTEND_DIR" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if ! env | grep -q '^VITE_'; then
  echo "[ERROR] No VITE_* variables loaded from: $ENV_FILE" >&2
  exit 1
fi

echo "[INFO] Building frontend in: $FRONTEND_DIR"
echo "[INFO] Using env file: $ENV_FILE"

cd "$FRONTEND_DIR"
npm ci
npm run build

echo "[OK] Frontend build completed."
