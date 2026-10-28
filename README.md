# burnYourToken

从 Claude 用量页抄三个数，按还剩多少推荐一个项目。你自己点卡片才算选上：这一页不读用量，也不会自动开始、自动消耗额度。

Copy three numbers from the Claude usage page, then pick a project yourself. The page does not read your quota and does not start anything for you.

## 在本机打开（能点击）

需要 Python 3。不用安装依赖，也不用构建。

### 方式 A：一条命令

```sh
sh scripts/serve.sh
```

浏览器打开它打印出来的地址：<http://127.0.0.1:8000/>

换端口：`PORT=8765 sh scripts/serve.sh`。停掉：在那个窗口按 Ctrl+C。

### 方式 B：直接打开文件

双击仓库里的 `index.html`，或在仓库目录执行：

```sh
xdg-open index.html   # Linux
open index.html       # macOS
```

两种都能点完下面的流程。页面只加载同目录的 `css/` 和 `js/`。

## 点一遍

1. 打开后先看第 1 步。路径是 `Claude` → `Settings` → `Usage`。下面三行写着要抄的数：① 5 小时额度（Session）的百分比，② 这段还要多久重置（Resets in），③ 每周额度（Weekly）的百分比和周几几点。按钮下面是空状态：还没算，不会出项目。
2. 点「填示例试试」。格子里出现 72、3 小时 12 分、31、周四 08:00。这一下只是填数，不会自己算。
3. 点「算一下」。示例是中档，并写明是哪条规则。
4. 第 2 步可以不填。点「跳过，直接看推荐」，或直接滚到第 3 步。
5. 出现项目卡。点「我做完了」只记下这一笔，并请你回用量页把 ①②③ 再抄一遍。没有自动开始，也没有去读用量。

格子空着再点「算一下」，红框会标出是哪一个数还空着。数字超出 0–100，会说填错了，而不是说空着。选「我是按 API 用量付钱的」会说明不适用，没有项目卡。

## 测试（可选）

需要本机有 Chrome 或 Chromium。脚本会自己找真正的浏览器；找不到就装一个，或写上完整路径。如果 PATH 里的 `google-chrome` 是包装脚本、测试一直不结束，用下面的 `CHROME=`。

```sh
sh tests/run.sh
CHROME=/完整路径 sh tests/run.sh
```

只访问 `127.0.0.1`。全部通过时最后一行是「全部通过」。

更早的设计记录在 `PROTOTYPE-REPORT.md` 和 `BURNYOURTOKEN-PREFERENCE-REPORT.md`。那两份里的打开方式和一部分阈值已经过时，以本页和第 1 步页面上的说明为准。
