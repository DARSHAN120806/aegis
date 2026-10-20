#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd backend && ../.venv/bin/ruff check app tests && ../.venv/bin/ruff format --check app tests && ../.venv/bin/pytest -q)
(cd chaincode && npm run build && npm test)
(cd frontend && npm run build && npm run test:e2e)
