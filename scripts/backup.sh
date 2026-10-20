#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
: "${BACKUP_DIR:?Set an encrypted backup destination}"
mkdir -p "$BACKUP_DIR"
umask 077
name="aegis-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres \
 pg_dump -U aegis_owner -d aegis --format=custom > "$BACKUP_DIR/$name"
test -s "$BACKUP_DIR/$name"
printf 'Database backup written: %s\n' "$name"
