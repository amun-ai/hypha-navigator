/**
 * Offscreen document — hosts the single, browser-wide Hypha connection (needs a
 * DOM + a stable lifetime, which the service worker lacks). It registers ONE
 * service whose tools are proxied to the background SW, which dispatches them to
 * browser APIs (tabs/windows) or to the target tab's content script.
 *
 * Uses NO chrome.storage (restricted in offscreen documents) — the SW owns
 * persistence and drives (re)connect by sending {__off:"connect"}.
 */
import * as hyphaRpc from "hypha-rpc";
import { buildCatalog } from "./service-catalog.js";
import { generateSkillMd } from "./shared/services/skill.js";
import { buildServiceUrl, randomHex } from "./shared/relay/service-url.js";
import { wrapFn as baseWrapFn } from "./shared/utils/wrap-fn.js";

let server: any = null;
let connecting = false;

// Guidance injected into get_skill_md — teaches the efficient explore→script→
// accumulate-skills loop so the agent gets smarter and cheaper on each site.
const SKILL_GUIDANCE = [
  "## How to work efficiently (read this first)",
  "",
  "You drive a whole browser. The single biggest win is REUSE: explore a site ONCE,",
  "then SAVE what you worked out as site skills and site tools so you — and every future",
  "session — never have to re-explore or re-script it. Optimize for FEW steps, FEW tokens.",
  "",
  "### Per-site memory: skills + tools (USE these before anything else)",
  "",
  "Both are bound to a site ORIGIN (e.g. `https://example.com`) and are AUTO-SURFACED on",
  "every operation result — read the `origin`, `site_skills`, `site_tools` fields and the",
  "`site_skills_hint` / `site_tools_hint`, and act on them. Two complementary kinds:",
  "",
  "- **Site SKILLS = markdown know-how.** A note about one operation (how to search, export,",
  "  log in…): the recipe, API endpoints, key selectors/indices, steps, and gotchas. For",
  "  knowledge a future session should follow.",
  "- **Site TOOLS = callable code.** A named, parameterized JS function you run BY NAME with",
  "  arguments — no script re-sent. For any operation you'll repeat: make it a tool, then just",
  "  call it. This is the fast path.",
  "",
  "**Always start by reusing — don't re-discover what's already saved:**",
  "1. On a site, look at the `site_skills` / `site_tools` already on your result (or call",
  "   `list_site_tools(origin)` / `list_site_skills(origin)`). If a tool fits, just",
  "   `call_site_tool(origin, name, args)`. If a skill fits, follow it. Reuse beats exploring.",
  "2. **Explore only when nothing fits**, with `get_browser_state`, `query_dom`, `get_html`,",
  "   `take_screenshot`, `get_react_tree` — learn the page's structure and interactive elements.",
  "3. **Script, don't click.** Prefer `execute_script`: read/modify state and call the site's OWN",
  "   APIs with `fetch` (discover endpoints by watching network calls / inspecting `window`).",
  "   Far cheaper than UI click/type round-trips. Batch many items into ONE call.",
  "",
  "**Then SAVE it for reuse — do this EVERY time you work something out (this is what makes",
  "you fast and cheap over time, so don't skip it):**",
  "- Repeatable operation with clear inputs → **register a TOOL**:",
  "  `set_site_tool(origin, name, description, params, code)`. `params` is an array of",
  "  `{name, type?, description?, required?, default?}`; `code` is a JS body with the call",
  "  arguments in scope as an `args` object and the LAST expression auto-returned (async/await",
  "  + `fetch` supported). Afterwards run it with `call_site_tool(origin, name, args)`.",
  "- Know-how / context worth remembering → **write a SKILL**:",
  "  `set_site_skill(origin, name, description, content)` where `content` is concise markdown",
  "  (recipe, endpoints, selectors, steps, gotchas) a future session can follow without re-exploring.",
  "- `name`: short, stable, lowercase-hyphenated — e.g. `search`, `export-report`, `login`.",
  "- To UPDATE: read first (`get_site_tool` / `get_site_skill`), edit, and set again under the",
  "  same name; prune stale ones with `remove_site_tool` / `remove_site_skill`. A skill's markdown",
  "  may reference tool names, so the two work together.",
  "",
  "Rule of thumb: the SECOND time you'd run the same script, turn it into a site tool; whenever",
  "you learn something non-obvious about a site, write a site skill.",
  "",
  "**Loop:** check site_skills + site_tools on each result → reuse (`call_site_tool` / follow a",
  "skill) → else explore once + `execute_script` & batch → SAVE a tool and/or skill for next time.",
  "Each origin gets faster and cheaper the more you reuse and register.",
  "",
  "## Tab hygiene — REUSE the target tab, don't pile up new ones",
  "",
  "There is ONE **target tab** (the 'main' tab) that all page tools act on. Keep working",
  "in it instead of spawning a tab per step:",
  "- **To go to a new page, call `navigate(url)`** — it loads the URL in the CURRENT target",
  "  tab (reuse). This is the default for moving around.",
  "- **Only use `open_tab(url)` when you genuinely need a SEPARATE tab** open at the same time",
  "  (e.g. compare two pages, or keep a page while opening another). It creates a new tab and",
  "  retargets to it.",
  "- **`activate_tab(tab_id)`** switches the target to an already-open tab (see `list_tabs`) —",
  "  prefer this over opening a duplicate of a page that's already open.",
  "- **Clean up: `close_tab(tab_id)` any EXTRA tabs you opened** once you're done with them, so",
  "  you don't leave the user with a mess. Don't close tabs you didn't open, and keep the main",
  "  target tab unless you're replacing it.",
  "",
  "Every result includes the target tab's `origin`; `get_active_tab`/`list_tabs` tell you which",
  "tab is the target and what else is open.",
  "",
  "**Target a SPECIFIC tab with `tab_id` (drive several tabs in parallel).** Page tools,",
  "`execute_script`, `take_screenshot`, `navigate`, and the history tools all accept an optional",
  "`tab_id` (the id from `open_tab`/`list_tabs`). Pass it to act on that EXACT tab WITHOUT",
  "changing the shared default target — so you can work across multiple tabs at once, and",
  "multiple agents can each operate on their own tab independently. Typical flow: `open_tab` →",
  "use the returned tab id as `tab_id` on every following call. Omit `tab_id` to use the default",
  "target tab (set by Pin / open_tab / activate_tab).",
].join("\n");

function getConnect(): (cfg: any) => Promise<any> {
  const override = (globalThis as any).__HYPHA_CONNECT__;
  if (typeof override === "function") return override;
  const mod: any = hyphaRpc as any;
  if (mod.connectToServer) return mod.connectToServer;
  if (mod.hyphaWebsocketClient?.connectToServer)
    return mod.hyphaWebsocketClient.connectToServer;
  throw new Error("hypha-rpc connectToServer not found");
}

function ui(data: any): void {
  chrome.runtime.sendMessage({ __ui: true, ...data }).catch(() => {});
}

/** Proxy a tool call through the SW (which runs it / routes it to a tab). */
function makeProxy(name: string, schema: any): any {
  const inner = async (...args: any[]) => {
    const r = await chrome.runtime.sendMessage({ __hyphaCall: true, method: name, args });
    if (r && r.__error) throw new Error(r.__error);
    return r ? r.value : undefined;
  };
  (inner as any).__schema__ = schema;
  return baseWrapFn(inner);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

async function connect(config: any): Promise<void> {
  if (connecting || server) return; // already connecting or connected
  connecting = true;
  try {
    // NOTE: do NOT use chrome.storage here — it is restricted in offscreen
    // documents and throwing/hanging would abort the connect. The service
    // worker owns persistence (it watches our __ui messages).
    ui({ type: "status", status: "connecting" });
    ui({ type: "log", msg: `connecting to ${config.server_url} …`, kind: "status" });
    console.log("[hypha-offscreen] connecting to", config.server_url);
    const connectToServer = getConnect();
    const baseCfg: any = { server_url: config.server_url };
    if (config.token) baseCfg.token = config.token;
    const cfg: any = { ...baseCfg };
    if (config.workspace) cfg.workspace = config.workspace;

    try {
      server = await withTimeout(connectToServer(cfg), 25000, "connect");
    } catch (e: any) {
      // A saved workspace may be stale/expired — retry with a fresh one.
      if (config.workspace) {
        ui({ type: "log", msg: "retrying without the saved workspace …", kind: "status" });
        server = await withTimeout(connectToServer({ ...baseCfg }), 25000, "connect");
      } else {
        throw e;
      }
    }
    ui({
      type: "log",
      msg: `connected (workspace ${server.config?.workspace ?? "?"}), registering tools …`,
      kind: "status",
    });

    const catalog = buildCatalog();
    const serviceId = config.service_id || `web-navigator-${randomHex(16)}`;
    const def: any = {
      id: serviceId,
      name: config.service_name || "Browser Navigator",
      type: "browser-automation",
      description:
        "Remote browser automation: drive tabs (open/close/navigate/switch) and inspect & control the target page (DOM, screenshots, click/type by index, React).",
      config: { visibility: config.require_token ? "protected" : "unlisted" },
    };
    for (const { name, schema } of catalog) def[name] = makeProxy(name, schema);

    // get_skill_md is generated here from the FULL catalog (incl. browser tools).
    let serviceUrl = "{SERVICE_URL}";
    const skillFn: any = () => {
      const fns: Record<string, any> = {};
      for (const { name, schema } of catalog) fns[name] = { __schema__: schema };
      return generateSkillMd(fns, serviceUrl, undefined, SKILL_GUIDANCE);
    };
    skillFn.__schema__ = {
      name: "get_skill_md",
      description:
        "Full API documentation for all browser + page tools, with usage examples.",
      parameters: { type: "object", properties: {} },
    };
    def.get_skill_md = baseWrapFn(skillFn);

    // Register the service. Surface the EXACT failure (server rejection reason)
    // into the side-panel log, and retry once — a registration can fail
    // transiently right after (re)connect (e.g. the manager service not yet
    // ready), which would otherwise leave the user stuck on "error".
    const fnCount = Object.keys(def).filter((k) => typeof def[k] === "function").length;
    ui({ type: "log", msg: `registering service with ${fnCount} tools …`, kind: "status" });
    let info: any;
    try {
      info = await withTimeout<any>(server.registerService(def), 25000, "register service");
    } catch (regErr: any) {
      const detail = regErr?.message ?? String(regErr);
      console.error("[hypha-offscreen] registerService failed:", regErr);
      ui({ type: "log", msg: `registerService failed: ${detail} — retrying …`, kind: "error" });
      await new Promise((r) => setTimeout(r, 1500));
      info = await withTimeout<any>(server.registerService(def), 25000, "register service (retry)");
    }
    serviceUrl = buildServiceUrl(config.server_url, info.id ?? serviceId);
    const workspace = server.config?.workspace ?? "";
    const token = config.require_token
      ? await server.generateToken({ expires_in: 86400 })
      : "";
    // The SW persists status/service_url from these __ui messages.
    ui({ type: "ready", service_url: serviceUrl, token, workspace });
    ui({ type: "status", status: "connected", detail: serviceUrl });
  } catch (e: any) {
    server = null;
    console.error("[hypha-offscreen] connect failed:", e);
    ui({ type: "status", status: "error", detail: e?.message ?? String(e) });
  } finally {
    connecting = false;
  }
}

async function disconnect(): Promise<void> {
  // Clear the reference first so a hung server.disconnect() can never block a
  // subsequent connect; do the actual teardown best-effort in the background.
  const s = server;
  server = null;
  try {
    s?.disconnect?.();
  } catch {
    /* ignore */
  }
  ui({ type: "status", status: "disconnected" });
}

chrome.runtime.onMessage.addListener((msg: any) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.__off === "connect") void connect(msg.config);
  else if (msg.__off === "disconnect") void disconnect();
  // keepalive ping from SW — receiving it is enough to keep us warm.
});

// The service worker drives connection: it sends {__off:"connect"} after
// creating us (and on reconcile). We tell it we're ready in case it created us
// and the message raced ahead of this listener.
chrome.runtime.sendMessage({ __off: "offscreenReady" }).catch(() => {});

// Keepalive: periodic message keeps the SW warm and signals we're alive.
setInterval(() => {
  chrome.runtime.sendMessage({ __off: "keepalive", connected: !!server }).catch(() => {});
}, 20000);
