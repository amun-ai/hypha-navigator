# Hypha Debugger — Chrome extension (MV3)

Attach a remote **Hypha debugger** to **any** web page — including strict-CSP sites that block the
bookmarklet — and control it from an AI agent over Hypha RPC, exactly like the bookmarklet/library
(`get_browser_state`, `click_element_by_index`, `take_screenshot`, `get_react_tree`, …).

## Why an extension (vs the bookmarklet)
The bookmarklet runs in the page's realm, so a strict CSP (`connect-src 'self'`) blocks its WebSocket
to Hypha. The extension runs the connection in a **privileged context** the page CSP can't touch:

- **Content script (isolated world)** — the in-page *Agent*: runs the debug services against the DOM.
  Injected regardless of `script-src`.
- **Offscreen document** — the *Connector*: owns the Hypha WebSocket (extension context, immune to the
  page's `connect-src`). Has a real DOM + stable lifetime, so hypha-rpc runs there and survives
  service-worker naps.
- **Service worker** — a stateless router between content ↔ offscreen, plus connect/disconnect and
  restart-tolerant reconnect (state persisted in `chrome.storage`).
- **Side panel** — connection controls + a live activity log (replaces the floating overlay).
- **MAIN-world helper** — only for `get_react_tree` (React fiber expandos aren't visible in the
  isolated world).

The smart-DOM "page agent" features come from the same vendored `@page-agent/page-controller` the
library uses; the extension reuses page-agent's architecture pattern (content/offscreen/side panel).

## Build
From the `javascript/` package (its `node_modules` provides esbuild/hypha-rpc):

```bash
cd javascript
npm install        # once
npm run build:extension
```

Output: `extension/dist/` — a loadable unpacked extension.

## Load
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `extension/dist/`.
3. Click the toolbar icon to open the side panel.

## Use
1. Open the page you want to debug, then open the side panel.
2. (Optional) set the Hypha server URL (default `https://hypha.aicell.io`).
3. **Connect this tab** → the side panel shows the **service URL** and a live log.
4. Paste the service URL into your AI agent. It can call the debug API over HTTP, e.g.:
   ```bash
   curl "$SERVICE_URL/get_browser_state?_mode=last"
   curl "$SERVICE_URL/get_skill_md?_mode=last"     # full API docs
   ```

`execute_script` (arbitrary JS) needs page `unsafe-eval`; if the page blocks it, use the DOM services
(`get_browser_state`, `click_element_by_index`, `query_dom`, …) which never need eval. An optional
CSP-strip (declarativeNetRequest) to re-enable it can be added behind a permission prompt.

## Notes
- **Persistent / restart-tolerant:** the connection lives in the offscreen document and is restored
  from `chrome.storage` after a service-worker nap; closing a tab disconnects it.
- Requires Chrome/Edge 116+ (offscreen + side panel APIs).
