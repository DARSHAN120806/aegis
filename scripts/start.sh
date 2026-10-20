#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/setup.py
command -v docker >/dev/null || { echo 'Docker is required for Compose. See README for native demo setup.'; exit 1; }
docker compose up --build -d
