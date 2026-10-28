#!/bin/sh
# 用无头 Chrome 跑全部测试，打印每一条结果和每一次运行的控制台消息数。只在本机运行，不联网（只访问 127.0.0.1）。
# 用法：sh tests/run.sh            （需要 python3，以及 Chrome 或 Chromium）
#       CHROME=/完整路径 sh tests/run.sh
#       sh tests/run.sh shot 375   （另外存一张 375px 宽的整页截图到 /tmp/qp-shot-375.png）
# 控制台：单元测试、页面流程测试、直接打开 index.html（http 和 file://）都要求 0 条消息（任何级别）。
#         只有「不联网探针」会故意发请求，被拦下时的提示是预期的，单独列出来。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"
PROFILE="$(mktemp -d /tmp/qp-chrome.XXXXXX)"
FAILED=0

# macOS 用应用程序路径。Linux 先找真正的浏览器二进制，再看 PATH。
# 有的环境里 PATH 上的 google-chrome 是包了一层的脚本（固定用户目录、远程调试），
# 无头跑测试会挂住。CHROME=/完整路径 可以盖过自动查找。
find_chrome() {
  if [ -n "${CHROME:-}" ]; then
    if [ -x "$CHROME" ]; then
      printf '%s\n' "$CHROME"
      return 0
    fi
    echo "CHROME 指到的文件不能运行：$CHROME" >&2
    return 1
  fi
  mac="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [ -x "$mac" ]; then
    printf '%s\n' "$mac"
    return 0
  fi
  for path in \
    /usr/bin/google-chrome-stable \
    /usr/bin/google-chrome \
    /opt/google/chrome/chrome \
    /usr/bin/chromium \
    /usr/bin/chromium-browser
  do
    if [ -x "$path" ]; then
      printf '%s\n' "$path"
      return 0
    fi
  done
  for name in google-chrome google-chrome-stable chromium chromium-browser; do
    found=$(command -v "$name" 2>/dev/null || true)
    if [ -n "$found" ] && [ -x "$found" ]; then
      printf '%s\n' "$found"
      return 0
    fi
  done
  echo "找不到 Chrome / Chromium。安装一个，或：CHROME=/完整路径 sh tests/run.sh" >&2
  return 1
}

CHROME_BIN=$(find_chrome) || exit 1
# 容器和部分 Linux 上沙箱起不来。这里只打开本机测试页。
SANDBOX_FLAGS=""
if [ "$(uname -s)" != "Darwin" ]; then
  SANDBOX_FLAGS="--no-sandbox --disable-dev-shm-usage"
fi
# 浏览器没自己退出时不要一直等。macOS 往往没有 timeout，没有就直接跑。
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT="timeout 90"
fi
echo "用浏览器：$CHROME_BIN"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; rm -rf "$PROFILE"' EXIT
sleep 1

# run 名字 地址 [其他参数]：DOM 存到 $PROFILE/名字.html，控制台存到 $PROFILE/名字.log
run() {
  name="$1"; url="$2"; shift 2
  # SANDBOX_FLAGS、TIMEOUT 在需要时才是参数，故意不打引号。
  # shellcheck disable=SC2086
  $TIMEOUT "$CHROME_BIN" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE/profile-$name" --virtual-time-budget=60000 --enable-logging=stderr --v=0 \
    $SANDBOX_FLAGS \
    "$@" --dump-dom "$url" >"$PROFILE/$name.html" 2>"$PROFILE/$name.log"
}

# report 名字 tests|page 控制台要求（zero | expected）
report() {
  python3 - "$PROFILE/$1.html" "$PROFILE/$1.log" "$2" "$3" <<'PY'
import re, sys, html
dom_path, log_path, kind, console_rule = sys.argv[1:5]
dom = open(dom_path, encoding="utf-8").read()
bad = False
if kind == "tests":
    summary = re.search(r'id="summary"[^>]*>(.*?)<', dom)
    for li in re.findall(r'<li class="(pass|fail)">(.*?)</li>', dom, re.S):
        print(("  ✓ " if li[0] == "pass" else "  ✗ ") + html.unescape(re.sub(r"<[^>]+>", "", li[1])))
    line = summary.group(1) if summary else "没跑完（可能有脚本报错）"
    print("  结果：" + line)
    bad = not line.startswith("PASS")
else:
    ok = ('id="svc-claude"' in dom and 'id="svc-chatgpt"' not in dom
          and '从 Claude 用量页抄三个数' in dom and '填示例试试' in dom
          and 'name="q-output"' in dom and 'name="q-audience"' in dom)
    print("  页面：" + ("正常显示（Claude 抄用量和问卷都在）" if ok else "没有正常显示"))
    bad = not ok
msgs = [l.strip() for l in open(log_path, encoding="utf-8", errors="replace")
        if ":CONSOLE" in l or "Uncaught" in l]
if console_rule == "zero":
    print("  控制台消息：%d 条" % len(msgs))
    for m in msgs:
        print("    " + m[:300])
    bad = bad or bool(msgs)
else:
    blocked = [m for m in msgs if "Content Security Policy" in m]
    other = [m for m in msgs if m not in blocked]
    print("  控制台：%d 条「请求被拦下」的提示（探针故意发的，预期内），其他消息 %d 条" % (len(blocked), len(other)))
    for m in other:
        print("    " + m[:300])
    bad = bad or bool(other) or not blocked
sys.exit(1 if bad else 0)
PY
  [ $? -eq 0 ] || FAILED=1
}

echo "== 单元测试（tests/unit.html）=="
run unit "http://127.0.0.1:$PORT/tests/unit.html"
report unit tests zero

echo "== 页面流程测试（tests/e2e.html）=="
run e2e "http://127.0.0.1:$PORT/tests/e2e.html"
report e2e tests zero

echo "== 直接打开 index.html（http）=="
run page-http "http://127.0.0.1:$PORT/index.html"
report page-http page zero

echo "== 直接双击打开 index.html（file://）=="
run page-file "file://$ROOT/index.html"
report page-file page zero

echo "== 不联网探针（tests/probe.html）=="
run probe "http://127.0.0.1:$PORT/tests/probe.html"
report probe tests expected

if [ "${1:-}" = "shot" ]; then
  W="${2:-375}"
  # shellcheck disable=SC2086
  $TIMEOUT "$CHROME_BIN" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE/profile-shot" --virtual-time-budget=60000 \
    $SANDBOX_FLAGS \
    --hide-scrollbars --window-size="$W,9000" --screenshot="/tmp/qp-shot-$W.png" \
    "http://127.0.0.1:$PORT/tests/e2e.html?shot=$W" >/dev/null 2>&1
  echo "== 截图：/tmp/qp-shot-$W.png =="
fi

if [ "$FAILED" -eq 0 ]; then echo "== 全部通过 =="; else echo "== 有没通过的，看上面 =="; fi
exit "$FAILED"
