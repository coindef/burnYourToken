#!/bin/sh
# 用无头 Chrome 跑全部测试，打印每一条结果和每一次运行的控制台消息数。只在本机运行，不联网（只访问 127.0.0.1）。
# 用法：sh tests/run.sh            （需要本机装了 Google Chrome 和 python3）
#       sh tests/run.sh shot 375   （另外存一张 375px 宽的整页截图到 /tmp/qp-shot-375.png）
# 控制台：单元测试、页面流程测试、直接打开 index.html（http 和 file://）都要求 0 条消息（任何级别）。
#         只有「不联网探针」会故意发请求，被拦下时的提示是预期的，单独列出来。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-8765}"
PROFILE="$(mktemp -d /tmp/qp-chrome.XXXXXX)"
FAILED=0

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; rm -rf "$PROFILE"' EXIT
sleep 1

# run 名字 地址 [其他参数]：DOM 存到 $PROFILE/名字.html，控制台存到 $PROFILE/名字.log
run() {
  name="$1"; url="$2"; shift 2
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE/profile-$name" --virtual-time-budget=60000 --enable-logging=stderr --v=0 \
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
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE/profile-shot" --virtual-time-budget=60000 \
    --hide-scrollbars --window-size="$W,9000" --screenshot="/tmp/qp-shot-$W.png" \
    "http://127.0.0.1:$PORT/tests/e2e.html?shot=$W" >/dev/null 2>&1
  echo "== 截图：/tmp/qp-shot-$W.png =="
fi

if [ "$FAILED" -eq 0 ]; then echo "== 全部通过 =="; else echo "== 有没通过的，看上面 =="; fi
exit "$FAILED"
