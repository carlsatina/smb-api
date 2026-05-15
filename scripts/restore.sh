#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set to run restores." >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required but not found in PATH." >&2
  exit 1
fi

if [[ -z "${BACKUP_FILE:-}" ]]; then
  echo "BACKUP_FILE must point to a .dump file to restore." >&2
  exit 1
fi

pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$BACKUP_FILE"

echo "Restore completed from $BACKUP_FILE"
