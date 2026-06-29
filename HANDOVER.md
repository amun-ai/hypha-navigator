# Hypha Navigator — Handover

You are taking over a new standalone project: **Hypha Navigator**, an AI **browser-automation
Chrome extension** (MV3) built on [Hypha](https://github.com/amun-ai/hypha) RPC. It started life as
the Chrome extension inside the sibling repo `../hypha-debugger` (npm package `hypha-debugger`), but
it has outgrown the "debugger" framing — it is a full browser automation tool for AI agents. Your job
is to turn this folder into its own published repo at **`amun-ai/hypha-navigator`**, rebranded, with
its own build + CI + GitHub Pages download, while the old repo keeps the extension only as a pointer
("advanced debugger — now lives at amun-ai/hypha-navigator").

## What this extension does (feature summary)

A single MV3 extension that lets a remote AI agent drive the **whole browser** over Hypha RPC:

- **One persistent Hypha connection** in an **offscreen document** (the service worker is ephemeral;
  the offscreen has a real DOM + stable lifetime). It registers ONE Hypha service whose tools are
  proxied to the SW. The SW is the dispatcher.
- **Browser tools** (run in the SW via chrome.tabs/windows): `list_tabs`, `get_active_tab`,
  `open_tab`, `close_tab`, `activate_tab`, `navigate`, `reload_tab`, `go_back`, `go_forward`.
- **Page tools** (act on the current TARGET tab, routed to its content script, injected on demand):
  `get_browser_state` (smart indexed DOM), `click_element_by_index`, `input_text`, `select_option`,
  `scroll`, `take_screenshot`, `query_dom`, `get_html`, `get_react_tree` (via a MAIN-world bridge),
  `get_page_info`, …
- **`execute_script`** runs arbitrary JS in the page **even on strict-CSP / no-unsafe-eval pages**,
  via the Chrome **debugger** (CDP `Page.setBypassCSP` + `Runtime.evaluate`) — the Puppeteer/
  Playwright approach. Shows Chrome's "debugging this browser" banner; needs the `debugger` permission.
- **Stable target tab**: the agent sticks to a pinned tab (persisted in `chrome.storage.local`,
  re-hydrated on every call) instead of following the user's active tab. Side panel has **Pin
  current** + **Focus** (bring target to front).
- **Per-site Agent Skills** (the smart part): the extension accumulates **site skills** — each is an
  **Agent Skill per [agentskills.io](https://agentskills.io/specification)**: a `name`
  (1-64 chars, lowercase/digits/hyphens), a `description` (≤1024), and a markdown SKILL.md `content`
  body. Skills are **bound to a site origin**; a site can have many. Tools: `list_site_skills`
  (returns name+description grouped by origin), `get_site_skill(origin, name)` (returns assembled
  SKILL.md + parts), `set_site_skill(origin, name, description, content)`, `remove_site_skill(origin,
  name)`. EVERY operation result is auto-augmented with the current `origin`, a name/description skill
  index (`site_skills`), and a `site_skills_hint` (reuse if any exist, else explore efficiently + save
  one). This makes the agent smarter and cheaper on each site over time.
- **Durable persistence**: `chrome.storage.local` (`unlimitedStorage`) is the working store; it is
  mirrored to **account-synced** `chrome.storage.sync` (chunked to respect the ~8KB/item, ~100KB
  total quota) so skills **survive uninstall/reinstall**. Over quota → catalog-only (names +
  descriptions) backup; full fidelity via side-panel **Export/Import** JSON (under Advanced).
- **Side panel** (not a popup): connect/disconnect, the service URL + "Copy URL" / "Copy agent
  prompt" (with Copied! feedback), target tab + Pin/Focus, site-skill counts, Advanced (workspace/
  token/require-token, Export/Import). Title shows the version so users can confirm a reload.

## Source layout (already copied into this folder)

- `extension/` — `manifest.json`, `src/{background,offscreen,content,sidepanel,browser-tools,
  service-catalog,main-world}.ts`, `sidepanel.html`, `offscreen.html`, `INSTALL.txt`, `tsconfig.json`.
- `javascript/` — the shared core the extension imports from (`src/services/*`, `src/relay/*`,
  `src/page-controller/*`, `src/utils/wrap-fn.ts`) **plus** the original `hypha-debugger` npm library
  (bookmarklet, rollup config, relay connector, etc.) which the extension does NOT need. The build
  script is `javascript/scripts/build-extension.mjs` (esbuild; resolves cross-dir `.js`→`.ts`).
  `npm run build:extension` from `javascript/` emits `extension/dist/` and stamps the docs download link.

> Decide: vendor only the `javascript/src` modules the extension actually imports into
> `extension/` (cleaner standalone repo), OR keep depending on the published `hypha-debugger` npm
> package, OR keep the `javascript/` core as-is and just prune the non-extension parts. Vendoring the
> needed modules under `extension/src/shared/` is probably the cleanest for a focused repo.

## Your tasks

1. **Rebrand** everything from "Hypha Debugger" → **"Hypha Navigator"**: `manifest.json` `name`/
   `description`/`action.default_title`, the service `name`/`description` in `offscreen.ts`, the side
   panel title (`sidepanel.ts`/`.html`), `INSTALL.txt`, the copy-agent-prompt subject, and any
   "debugger" wording in user-facing strings. Keep the Hypha brand + gradient styling. NOTE: the
   `debugger` chrome **permission** and CDP usage stay (that's `execute_script`), just not the product
   *name*. Reset the version to a fresh `0.1.0` (or `1.0.0`) for the new repo.
2. **Make it build standalone** (see the vendoring decision above). `npm install` then a single
   `npm run build` should produce `extension/dist/` loadable as an unpacked extension. Keep the
   esbuild approach; keep `patchWebpackThis` (REQUIRED for the hypha-rpc bundle to load) and the
   CDP/CSP `execute_script`.
3. **Repo + CI + Pages**: `git init`, create `amun-ai/hypha-navigator` (`gh repo create amun-ai/
   hypha-navigator --public`), a README (what it is, install steps, the agent-skills story, a GIF/
   screenshot placeholder), a GitHub Pages `docs/` site with a **version-stamped** `.zip` download
   (mirror how `../hypha-debugger/docs` + `scripts/build-extension.mjs` stamp `?v=<version>` and the
   version span), and a CI workflow that builds + zips on tag/release. (Optional: Chrome Web Store
   listing later.)
4. **Point the old repo here**: in `../hypha-debugger`, update the extension section of `docs/
   index.html`, `README`, and `CLAUDE.md` to say the browser-automation extension now lives at
   `amun-ai/hypha-navigator` (frame the hypha-debugger extension as the "advanced debugger" lineage).
   Do this as a separate commit in that repo. (Coordinate with the hypha-debugger agent — see below.)
5. **Verify** as much as possible without a real Chrome (this machine has none): typecheck
   (`tsc -p extension/tsconfig.json --noEmit`), build, and a Node + mock-chrome logic test for the
   skill model / kwargs mapping / sync round-trip (there's a known-good test pattern — ask the
   hypha-debugger agent for `.skill-test.mjs`, or re-derive it). Document what can only be verified in
   real Chrome (the live Hypha WS handshake, CDP attach, side-panel UI).

## Critical learnings (do NOT relearn the hard way)

- **`chrome.storage` is restricted in MV3 offscreen documents** — the offscreen must use ONLY
  `chrome.runtime` messaging. The SW owns all persistence and drives (re)connect via `{__off:
  "connect"}`. A `chrome.storage` call in the offscreen's connect() silently aborted the whole
  connection in a past regression. When you write Node tests, mock chrome WITHOUT storage in the
  offscreen to catch this.
- **hypha-rpc** is webpack-built with `output.globalObject:'this'` and needs `patchWebpackThis` to
  load; it references `window`/`document` so it can't run in a bare SW → hence the offscreen. Its
  export is nested: `connectToServer` is at `mod.connectToServer` OR `mod.hyphaWebsocketClient
  .connectToServer`.
- **kwargs→positional**: `javascript/src/utils/wrap-fn.ts` maps an HTTP kwargs object to positional
  args **in schema `properties` order** via a toString override (CSP-safe, no `new Function`). So each
  tool's `run(ctx, [a, b, …])` destructuring MUST match its schema property order. Keep this.
- **esbuild cross-dir**: the build resolves `.js` imports to `.ts` via an onResolve plugin +
  `nodePaths`; that's why the build script lives in `javascript/scripts/`.
- This machine is in the **nono sandbox**: on any EPERM, tell the user to restart with
  `nono run --allow /path -- claude`. Never work around it.
- **Publishing**: an `NPM_TOKEN` is set as a GitHub Actions secret in `amun-ai/hypha-debugger` (and
  saved locally at `../hypha-debugger/.env`, gitignored) if you also publish an npm package. Commit/
  push only when the user asks.

## Coordination

The agent in `../hypha-debugger` (session that handed this off) owns that repo. When you need the
old repo updated to point here, coordinate via `svamp session send <its-id> "<msg>"` rather than
editing `../hypha-debugger` directly, to avoid edit conflicts. Use `svamp session list` to find it.

Set your session title (`svamp session set-title "Hypha Navigator repo"`) and, when you publish a
download/Pages link, set a session link.
