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

## Fill from Claude Usage

Optional. Copying the three numbers by hand still works if you never load the extension.

The extension does not calculate, does not mark a project done, and does not read Usage when the page loads. It does not call Claude. After you click **Fill from Claude Usage**, it reads the Usage tab you already have open.

### Load the unpacked extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder in this project.
4. If you open `index.html` as a file instead of the local server, open that extension’s details and turn on **Allow access to file URLs**.
5. In Chrome, open Claude → Settings → Usage and leave that tab open: `https://claude.ai/settings/usage`.
6. Open this page, click **Fill from Claude Usage**, pick a plan, then click **Get project**.

### Without the extension

Copy **Session**, **Resets in**, and **Weekly** from Claude → Settings → Usage. **Try sample** under **More** still fills the example numbers and runs **Get project**.

## Try it

1. A first visit shows **Leftover Claude quota?**, **Fill from Usage, then Mark done.**, and **Fill from Claude Usage**. Plan, usage fields, and **Get project** stay hidden until Fill succeeds.
2. After Fill, click **Get project**. Nothing runs until that click, and Fill does not mark a project done.
3. One full-width recommendation appears, with band chips above it. Open **Show steps** if you want them, then click **Mark done**.
4. **Try sample**, **How to copy**, **Preferences**, and **More projects** are under **More**. They are not a second card on the first screen.

Leave a field blank and **Get project** marks that field. A percent outside 0–100 says it must be 0–100. **API billing** has no session or weekly window, so this tool doesn’t apply.

## Tests (optional)

Needs Chrome or Chromium. The script looks for the real browser. If `google-chrome` on your PATH is a wrapper and the run never finishes, set `CHROME` to the binary.

```sh
sh tests/run.sh
CHROME=/full/path sh tests/run.sh
```

It only talks to `127.0.0.1`. A passing run exits 0.

Earlier design notes are in `PROTOTYPE-REPORT.md` and `BURNYOURTOKEN-PREFERENCE-REPORT.md`. Those notes are historical. This page and the on-screen steps are the current product.
