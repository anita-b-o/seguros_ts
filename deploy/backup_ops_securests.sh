#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-$SCRIPT_DIR/backup_securests.sh}"
CONFIG_FILE="${CONFIG_FILE:-/etc/securests/backup-ops.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

ENV_FILE="${ENV_FILE:-/etc/securests/backend.env}"
OUT_DIR="${OUT_DIR:-/srv/securests/backups/prod}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SKIP_MEDIA="${SKIP_MEDIA:-false}"
OFFSITE_ENABLED="${OFFSITE_ENABLED:-false}"
OFFSITE_RSYNC_TARGET="${OFFSITE_RSYNC_TARGET:-}"
OFFSITE_RSYNC_OPTS="${OFFSITE_RSYNC_OPTS:--az --partial --chmod=F600,D700}"
OFFSITE_SSH_OPTS="${OFFSITE_SSH_OPTS:-}"

run_backup() {
  local args=(
    --env-file "$ENV_FILE"
    --out-dir "$OUT_DIR"
    --retention-days "$RETENTION_DAYS"
  )
  if [[ "$SKIP_MEDIA" == "true" ]]; then
    args+=(--skip-media)
  fi
  "$BACKUP_SCRIPT" "${args[@]}"
}

latest_backup_dir() {
  find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1
}

verify_checksum() {
  local target_dir="$1"
  if [[ ! -f "$target_dir/SHA256SUMS" ]]; then
    echo "Missing checksum file: $target_dir/SHA256SUMS" >&2
    return 1
  fi
  (cd "$target_dir" && sha256sum -c SHA256SUMS >/dev/null)
}

sync_offsite() {
  local target_dir="$1"
  if [[ "$OFFSITE_ENABLED" != "true" ]]; then
    echo "Offsite sync disabled (OFFSITE_ENABLED=false)."
    return 0
  fi

  if [[ -z "$OFFSITE_RSYNC_TARGET" ]]; then
    echo "OFFSITE_ENABLED=true but OFFSITE_RSYNC_TARGET is empty." >&2
    return 1
  fi

  local -a rsync_cmd=(rsync)
  read -r -a rsync_extra <<<"$OFFSITE_RSYNC_OPTS"
  rsync_cmd+=("${rsync_extra[@]}")

  if [[ -n "$OFFSITE_SSH_OPTS" ]]; then
    rsync_cmd+=(-e "ssh $OFFSITE_SSH_OPTS")
  fi

  local backup_name
  backup_name="$(basename "$target_dir")"
  rsync_cmd+=("$target_dir/" "$OFFSITE_RSYNC_TARGET/$backup_name/")
  "${rsync_cmd[@]}"
}

main() {
  run_backup
  local target_dir
  target_dir="$(latest_backup_dir)"
  if [[ -z "${target_dir:-}" || ! -d "$target_dir" ]]; then
    echo "Could not determine latest backup directory in $OUT_DIR." >&2
    exit 1
  fi

  verify_checksum "$target_dir"
  sync_offsite "$target_dir"
  echo "Backup ops completed: $target_dir"
}

main "$@"
