#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON="$(./scripts/venv_python.sh)"

echo "Using python: $PYTHON"
"$PYTHON" -c "import django; print('django', django.get_version())"

"$PYTHON" -m pip install -r requirements.txt
"$PYTHON" manage.py test policies.tests
