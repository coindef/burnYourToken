#!/bin/sh
# Local page you can click. Listens on 127.0.0.1 only.
# Usage: sh scripts/serve.sh
#        PORT=8000 sh scripts/serve.sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
echo "Open http://127.0.0.1:${PORT}/"
echo "Stop: Ctrl+C in this window"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT"
