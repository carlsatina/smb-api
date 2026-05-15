#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set to run backups." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required but not found in PATH." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
backup_file="${BACKUP_FILE:-$BACKUP_DIR/sales_${timestamp}.dump}"

pg_dump --format=custom --file="$backup_file" "$DATABASE_URL"

echo "Backup saved to $backup_file"

if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  if ! [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
    echo "BACKUP_RETENTION_DAYS must be a number of days." >&2
    exit 1
  fi

  if [[ "${BACKUP_RETENTION_DAYS}" -gt 0 ]]; then
    find "$BACKUP_DIR" -type f -name "sales_*.dump" -mtime +"${BACKUP_RETENTION_DAYS}" -print -delete
  fi
fi
