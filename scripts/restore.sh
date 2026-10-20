#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_FILE:?Set an operator-selected backup file}"
: "${RESTORE_ACK:?Set RESTORE_ACK=isolated-database after stopping API/worker and selecting an EMPTY recovery database}"
[[ "$RESTORE_ACK" == isolated-database ]] || exit 1
[[ -s "$RESTORE_FILE" ]] || exit 1
cd "$(dirname "$0")/.."
# No --clean: never silently drops an existing production database.
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres \
 pg_restore -U aegis_owner -d aegis --exit-on-error --single-transaction < "$RESTORE_FILE"
