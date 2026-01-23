#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PYTHON="$ROOT_DIR/.venv/bin/python"

if [ -x "$PYTHON" ]; then
  echo "$PYTHON"
  exit 0
fi

cat 1>&2 <<'EOF'
Missing backend/.venv. Create it with:
  cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
EOF
exit 1
