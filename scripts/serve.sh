#!/bin/sh
# 在本机打开可以点击的页面。只监听 127.0.0.1，不对外。
# 用法：sh scripts/serve.sh
#       PORT=8000 sh scripts/serve.sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
echo "打开 http://127.0.0.1:${PORT}/"
echo "停掉：在这个窗口按 Ctrl+C"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT"
