# burnYourToken

Copy three numbers from Claude Usage. We’ll suggest a project that fits what’s left.

## Run

Python 3. No install and no build.

```sh
sh scripts/serve.sh
```

Open http://127.0.0.1:8000/

Another port: `PORT=8765 sh scripts/serve.sh`. Stop it with Ctrl+C in that window.

You can also open `index.html` directly (`xdg-open index.html` on Linux, `open index.html` on macOS). The page only loads `css/` and `js/` next to it.

## Try it

1. Click **Try sample**. Example numbers fill in and a project shows up.
2. Or copy **Session**, **Resets in**, and **Weekly** from Claude → Settings → Usage, then click **Calculate**.
3. Answer **Preferences**, or click **Skip to recommendations**.
4. Open **Show steps** if you want them, then click **Mark done**.
5. Re-copy the three numbers from Usage and click **Calculate** for the next project.

Leave a field blank and **Calculate** marks that field. A percent outside 0–100 says it must be 0–100. **API billing** has no session or weekly window, so this tool doesn’t apply.

## Tests (optional)

Needs Chrome or Chromium. The script looks for the real browser. If `google-chrome` on your PATH is a wrapper and the run never finishes, set `CHROME` to the binary.

```sh
sh tests/run.sh
CHROME=/full/path sh tests/run.sh
```

It only talks to `127.0.0.1`. A passing run exits 0.

Earlier design notes are in `PROTOTYPE-REPORT.md` and `BURNYOURTOKEN-PREFERENCE-REPORT.md`. Those notes are historical. This page and the on-screen steps are the current product.
