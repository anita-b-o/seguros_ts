#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUTPUT_ZIP="frontend.zip"

echo "Packaging frontend into ${OUTPUT_ZIP} (excluding build artifacts)..."
rm -f "$OUTPUT_ZIP"
zip -r "$OUTPUT_ZIP" frontend \
  -x \
    'frontend/node_modules/*' \
    'frontend/dist/*' \
    'frontend/test-results/*' \
    'frontend/playwright-report/*' \
    'frontend/.vite/*' \
    'frontend/.cache/*' \
    'frontend/coverage/*' \
    'frontend/.env*' \
    'frontend/**/*.log' \
    'frontend/**/.DS_Store' \
    'frontend/frontend.zip'

echo "Created ${OUTPUT_ZIP}."
