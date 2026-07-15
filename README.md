<h1 align="center">🧭 Hypha Navigator</h1>

<p align="center">
  <b>Let an AI agent drive your whole browser — over <a href="https://github.com/amun-ai/hypha">Hypha</a> RPC.</b><br/>
  An MV3 Chrome extension that exposes tabs, navigation, DOM, screenshots, click/type-by-index,
  React inspection, and arbitrary JavaScript (even on strict-CSP pages) as a single HTTP-callable service.
</p>

<p align="center">
  <a href="https://amun-ai.github.io/hypha-navigator/">Download &amp; docs</a> ·
  <a href="#install">Install</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#site-skills">Site skills</a> ·
  <a href="#build-from-source">Build</a>
</p>

---

> **Lineage:** Hypha Navigator grew out of the Chrome extension in
> [`amun-ai/hypha-debugger`](https://github.com/amun-ai/hypha-debugger). The
> `hypha-debugger` project remains the injectable **page debugger / bookmarklet
> library**; Hypha Navigator is the standalone **whole-browser automation
> extension** for AI agents.

## What it does

Hypha Navigator runs one persistent Hypha connection inside the extension and
registers **one service** an AI agent can call over plain HTTP. The agent gets:

- **Browser control** — `list_tabs`, `get_active_tab`, `open_tab`, `close_tab`,
  `activate_tab`, `navigate`, `reload_tab`, `go_back`, `go_forward`.
- **Page control** (acts on the current *target* tab) — `get_browser_state`
  (smart indexed DOM), `click_element_by_index`, `input_text`, `select_option`,
  `scroll`, `take_screenshot`, `query_dom`, `get_html`, `get_react_tree`,
  `get_page_info`, …
- **`execute_script`** — run arbitrary JS in the page and get the result back,
  **even on strict-CSP / no-`unsafe-eval` pages**, via the Chrome **debugger**
  (CDP `Page.setBypassCSP` + `Runtime.evaluate`) — the Puppeteer/Playwright
  approach. (Shows Chrome's "debugging this browser" banner while attached.)
- **A self-documenting API** — `GET <SERVICE_URL>/get_skill_md` returns the full
  tool reference with curl examples. Hand the agent just the URL.

The agent sticks to a **pinned target tab** (persisted, re-hydrated on every
call) so you can keep browsing in other tabs while it works. The side panel lets
you **Pin current** / **Focus** the target.

## Install

### From the release ZIP (recommended)

1. Download the latest **`hypha-navigator-extension.zip`** from the
   [project page](https://amun-ai.github.io/hypha-navigator/) (or the
   [Releases](https://github.com/amun-ai/hypha-navigator/releases)).
2. Unzip it somewhere permanent (Chrome loads the extension from this folder).
3. Open `chrome://extensions`, enable **Developer mode** (top-right).
4. **Load unpacked** → select the unzipped folder (the one with `manifest.json`).
5. Pin the **Hypha Navigator** toolbar icon. Requires Chrome/Edge **116+**.

### Use

1. Click the toolbar icon → the side panel opens.
2. (Optional) set the Hypha server URL (default `https://hypha.aicell.io`).
3. **Connect browser** → the panel shows a **Service URL** and a live log.
4. **Copy URL** (or **Copy agent prompt**) and paste it into your AI agent:

   ```bash
   curl "$SERVICE_URL/get_skill_md?_mode=last"          # full API + usage
   curl "$SERVICE_URL/list_tabs?_mode=last"
   curl -X POST "$SERVICE_URL/open_tab" -d '{"url":"https://example.com"}'
   curl "$SERVICE_URL/get_browser_state?_mode=last"     # current target tab
   ```

## Drive it from the command line (`hyd`)

Prefer a CLI over curl? The [`hypha-debugger`](https://pypi.org/project/hypha-debugger/)
pip package ships a **`hyd`** CLI (needs **hypha-debugger ≥ 0.2.4** for the certifi TLS
fix). Register this browser as a profile once, then drive it with tiny commands — the
same CLI also drives terminal (Python) targets.

```bash
pipx install hypha-debugger           # or: pip install hypha-debugger
hyd profile add web "$SERVICE_URL" --type browser   # add --token <t> if protected
export HYD_PROFILE=web

hyd 'document.title'                  # bare form runs JavaScript (execute_script)
hyd js 'await fetch("/api/data").then(r=>r.json())'
hyd nav 'https://example.com'         # navigate the page
hyd shot page.png                     # save a screenshot to a PNG
hyd call get_browser_state            # call any tool by name
```

`$SERVICE_URL` is the side panel's Service URL (if you copied the `get_skill_md` URL, drop
the trailing `/get_skill_md`). If `hyd` isn't on your PATH, use `python -m hypha_debugger.cli`.

## Site skills

The smart part: Hypha Navigator accumulates **per-site skills** — each an
[Agent Skill](https://agentskills.io/specification) (a `name`, a `description`,
and a markdown `SKILL.md` body) **bound to a site origin**. As the agent works
out how to do something on a site (search, export, log in, …), it saves a skill;
**every operation result is auto-augmented** with the current `origin`, that
origin's skill index, and a hint to reuse or record one. The agent gets smarter
and cheaper on each site over time.

- Tools: `list_site_skills`, `get_site_skill`, `set_site_skill`, `remove_site_skill`.
- **Durable:** stored in `chrome.storage.local` (`unlimitedStorage`) and mirrored
  to account-synced `chrome.storage.sync` (chunked) so skills survive
  uninstall/reinstall. Over quota → catalog-only backup; full fidelity via the
  side panel's **Export / Import** JSON (under *Advanced*).

## Build from source

Requires Node 18+ (Node 24 used for the test runner's TS support).

```bash
npm install
npm run build        # → dist/ (load unpacked in chrome://extensions)
npm run typecheck    # tsc --noEmit
npm test             # Node mock-chrome logic tests
npm run zip          # build + package dist/ → docs/hypha-navigator-extension.zip
```

### Architecture

| Context | Role |
|---|---|
| **Offscreen document** | Owns the single Hypha WebSocket (needs a DOM + stable lifetime; the SW is ephemeral). Registers the service; proxies tool calls to the SW. Uses **only** `chrome.runtime` messaging — `chrome.storage` is restricted in offscreen docs. |
| **Service worker** | The dispatcher: runs browser tools (`chrome.tabs`/`windows`), routes page tools to the target tab's content script, owns **all** persistence + reconnect. |
| **Content script** | Injected on demand into the target tab; runs the page/DOM services. |
| **MAIN-world bridge** | Only for `get_react_tree` (React fiber expandos aren't visible in the isolated world). |
| **Side panel** | Connect/disconnect, service URL, target tab + Pin/Focus, site-skill counts, Export/Import. |

The `hypha-rpc` bundle is webpack-built (`output.globalObject:'this'`) and is
patched at build time (`patchWebpackThis`) so it loads in the extension context.

## License

[MIT](./LICENSE) © Amun AI AB
