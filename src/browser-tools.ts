/**
 * Browser-level automation tools — schemas + implementations that run in the
 * background service worker (the only context with chrome.tabs / windows /
 * scripting). These let a remote agent drive the whole browser: list/open/close
 * tabs, switch the active/target tab, navigate, reload, history.
 *
 * Page-level tools (get_browser_state, click_element_by_index, screenshot, …)
 * operate on the current TARGET tab and are executed in that tab's content
 * script. activate_tab / open_tab set the target.
 */

import { autoReturn } from "./shared/services/execute.js";

export interface BrowserToolCtx {
  getTarget: () => number | null;
  setTarget: (tabId: number) => void;
  /** When true, never steal focus: open tabs in the background and retarget
   *  without bringing the tab to front. The "Focus" button is the manual override. */
  forceBackground?: () => boolean;
}

// ---- CDP eval: run JS in the page bypassing its CSP (incl. no-unsafe-eval) --
// This is the only way to execute arbitrary code on a strict-CSP page; it's how
// Puppeteer/Playwright/DevTools do it. Lazily attaches the debugger to the tab
// (shows Chrome's "debugging this browser" banner) and turns on Page.setBypassCSP.
const attached = new Set<number>();

async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    await chrome.debugger.sendCommand({ tabId }, "Page.setBypassCSP", { enabled: true });
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
  } catch {
    /* best-effort */
  }
}

export async function detachAll(): Promise<void> {
  for (const id of [...attached]) {
    try {
      await chrome.debugger.detach({ tabId: id });
    } catch {
      /* ignore */
    }
  }
  attached.clear();
}

export function forgetTab(tabId: number): void {
  attached.delete(tabId);
}

async function cdpEval(tabId: number, code: string, argsObj?: any): Promise<any> {
  try {
    await ensureAttached(tabId);
  } catch (e: any) {
    return {
      error:
        "Could not attach the Chrome debugger to this tab: " +
        (e?.message ?? e) +
        " (restricted page like chrome:// or the Web Store, or another debugger is already attached).",
    };
  }
  // call_site_tool injects the call arguments as an `args` object in scope; plain
  // execute_script passes none (preamble empty → identical behavior to before).
  const preamble = argsObj !== undefined ? `const args = ${JSON.stringify(argsObj)};\n` : "";
  const expression = `${preamble}(async () => { ${autoReturn(code)} })()`;
  const res: any = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    // awaitPromise makes CDP resolve our async IIFE and return its real value.
    // Do NOT set replMode:true — REPL mode returns the UNAWAITED completion value
    // (ignoring awaitPromise), so the Promise serializes by-value to {}. Each call
    // runs in its own function scope, so we don't need REPL's let-redeclaration.
    awaitPromise: true,
    userGesture: true,
  });
  if (res?.exceptionDetails) {
    const ex = res.exceptionDetails;
    return { error: ex.exception?.description || ex.exception?.value || ex.text || "Evaluation error" };
  }
  const r = res?.result || {};
  return { result: r.value !== undefined ? r.value : r.description ?? null, type: r.type };
}

/**
 * Screenshot via CDP Page.captureScreenshot. Unlike the html-to-image route (which
 * relies on requestAnimationFrame/paint and silently STALLS on background tabs —
 * the normal agent case), CDP renders the page off-screen and works regardless of
 * tab focus/visibility. Supports element/viewport/full-page + downscale via clip.scale.
 */
async function cdpScreenshot(
  tabId: number,
  opts: {
    selector?: string;
    format?: string;
    quality?: number;
    max_width?: number;
    max_height?: number;
    full_page?: boolean;
  },
): Promise<any> {
  try {
    await ensureAttached(tabId);
  } catch (e: any) {
    return { error: "Could not attach the Chrome debugger to this tab: " + (e?.message ?? e) };
  }
  const send = (m: string, p?: any) => chrome.debugger.sendCommand({ tabId }, m, p || {});
  try {
    const fmt = opts.format === "png" ? "png" : "jpeg";
    const q = Math.max(0, Math.min(1, opts.quality ?? 0.6));
    const maxW = opts.max_width ?? 800;
    const maxH = opts.max_height ?? 800;
    const metrics: any = await send("Page.getLayoutMetrics");
    const css = metrics.cssContentSize || metrics.contentSize || { width: 1280, height: 800 };
    const vp = metrics.cssVisualViewport || {};

    let clip: { x: number; y: number; width: number; height: number };
    if (opts.selector) {
      const r: any = await send("Runtime.evaluate", {
        expression: `(()=>{const e=document.querySelector(${JSON.stringify(
          opts.selector,
        )});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left+scrollX,y:b.top+scrollY,width:b.width,height:b.height};})()`,
        returnByValue: true,
      });
      const v = r?.result?.value;
      if (!v) return { error: `No element found for selector: ${opts.selector}` };
      clip = v;
    } else if (opts.full_page) {
      clip = { x: 0, y: 0, width: Math.ceil(css.width), height: Math.ceil(css.height) };
    } else {
      clip = {
        x: vp.pageX || 0,
        y: vp.pageY || 0,
        width: Math.ceil(vp.clientWidth || css.width),
        height: Math.ceil(vp.clientHeight || 800),
      };
    }
    if (!clip.width || !clip.height) return { error: "Could not determine screenshot area" };

    const scale = Math.min(1, maxW / clip.width, maxH / clip.height);
    const params: any = {
      format: fmt,
      captureBeyondViewport: true,
      clip: { ...clip, scale },
    };
    if (fmt === "jpeg") params.quality = Math.round(q * 100);

    const shot: any = await send("Page.captureScreenshot", params);
    const base64 = shot.data;
    const media_type = fmt === "png" ? "image/png" : "image/jpeg";
    return {
      base64,
      media_type,
      data_url: `data:${media_type};base64,${base64}`,
      format: fmt,
      width: Math.round(clip.width * scale),
      height: Math.round(clip.height * scale),
      size_kb: Math.round((base64.length * 0.75) / 1024),
    };
  } catch (e: any) {
    return { error: "Screenshot failed: " + (e?.message ?? e) };
  }
}

type Tool = {
  schema: any;
  run: (ctx: BrowserToolCtx, args: any[]) => Promise<any>;
};

declare const chrome: any;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function tabSummary(t: any) {
  return {
    id: t.id,
    title: t.title,
    url: t.url,
    origin: originOf(t.url), // pass this to the site-skill tools
    active: t.active,
    window_id: t.windowId,
    status: t.status,
  };
}

async function resolveTarget(ctx: BrowserToolCtx): Promise<number> {
  let id = ctx.getTarget();
  if (id != null) {
    try {
      await chrome.tabs.get(id);
      return id;
    } catch {
      /* target gone — fall through to active */
    }
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active) throw new Error("No active tab");
  ctx.setTarget(active.id);
  return active.id;
}

// ---- per-site skill memory ----------------------------------------------
// Reusable recipes an agent accumulates per site (origin), persisted in
// chrome.storage.local. The SW has storage access (the offscreen does not).
// Each skill is keyed by a NAME and carries a short description + full markdown
// content: listing returns name+description; the name is the key to read the
// full entry with get_site_skill.
const SKILLS_KEY = "hyphaSiteSkills";
type SkillEntry = { description: string; content: string };
// origin -> name -> entry. Legacy entries were a bare markdown string.
type SkillStore = Record<string, Record<string, SkillEntry | string>>;

/** Normalize a stored entry (string legacy form → {description, content}). */
function normEntry(e: SkillEntry | string | undefined): SkillEntry {
  if (e == null) return { description: "", content: "" };
  if (typeof e === "string") {
    const desc =
      e
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean)
        ?.replace(/^#+\s*/, "")
        .slice(0, 160) || "";
    return { description: desc, content: e };
  }
  return { description: e.description || "", content: e.content || "" };
}

// Each site skill is an Agent Skill (https://agentskills.io/specification): a
// `name` + `description` (the frontmatter) plus a markdown body (the content).

/** Coerce a name to the agentskills `name` rules: 1-64 chars, lowercase a-z/0-9
 *  and single hyphens, no leading/trailing/consecutive hyphens. */
function normName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-allowed runs → single hyphen
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
}

/** Assemble an agentskills.io-compliant SKILL.md (frontmatter + body). */
function toSkillMd(name: string, e: SkillEntry): string {
  const desc = e.description.replace(/\r?\n/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${e.content}`;
}

async function loadAllSkills(): Promise<SkillStore> {
  const r = await chrome.storage.local.get(SKILLS_KEY);
  return r[SKILLS_KEY] || {};
}
async function saveAllSkills(all: SkillStore): Promise<void> {
  await chrome.storage.local.set({ [SKILLS_KEY]: all });
  // local is wiped on uninstall; mirror is fired by the SW's storage.onChanged.
}

// ---- durability across uninstall/reinstall -------------------------------
// chrome.storage.local is cleared when the extension is removed. chrome.storage
// .sync is account-backed and survives reinstall (when the user is signed in to
// Chrome). We keep local as the working store and mirror it into sync, chunked
// to respect sync's ~8KB-per-item limit (~100KB total).
// The SAME chunked-mirror machinery backs both per-origin stores (site skills +
// site tools). A SyncStore describes one store's keys and its over-quota
// "strip the heavy body, keep the signature" fallback.
const SYNC_CHUNK = 7000;
interface SyncStore {
  localKey: string; // chrome.storage.local key (the working store)
  syncMeta: string; // chrome.storage.sync meta key
  syncPrefix: string; // chrome.storage.sync chunk-key prefix
  label: string; // for log messages
  stripBody: (all: any) => any; // over-quota: keep catalog/signature, drop body
}

const SKILLS_STORE: SyncStore = {
  localKey: SKILLS_KEY,
  syncMeta: "hyphaSkillsMeta",
  syncPrefix: "hyphaSkillsChunk",
  label: "site skills",
  stripBody: (all) => {
    const out: SkillStore = {};
    for (const [o, site] of Object.entries(all || {})) {
      out[o] = {};
      for (const [n, e] of Object.entries(site as any))
        out[o][n] = { description: normEntry(e as any).description, content: "" };
    }
    return out;
  },
};

async function writeSyncChunks(store: SyncStore, obj: any, partial: boolean): Promise<void> {
  const json = JSON.stringify(obj || {});
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += SYNC_CHUNK) chunks.push(json.slice(i, i + SYNC_CHUNK));
  const prev = (await chrome.storage.sync.get(store.syncMeta))[store.syncMeta];
  const prevN = prev?.chunks || 0;
  const set: any = { [store.syncMeta]: { chunks: chunks.length, partial } };
  chunks.forEach((c, i) => (set[store.syncPrefix + i] = c));
  await chrome.storage.sync.set(set);
  if (prevN > chunks.length) {
    const rm: string[] = [];
    for (let i = chunks.length; i < prevN; i++) rm.push(store.syncPrefix + i);
    await chrome.storage.sync.remove(rm);
  }
}

/**
 * Mirror a per-origin store into chrome.storage.sync (best-effort, account-backed
 * so it survives reinstall). Full bodies can exceed sync's ~100KB quota; if so,
 * fall back to backing up the catalog (signatures) only — the full content stays
 * in local (unlimitedStorage) and is portable via Export/Import.
 */
async function mirrorStoreToSync(store: SyncStore, all: any): Promise<void> {
  if (!chrome.storage?.sync) return;
  try {
    await writeSyncChunks(store, all || {}, false);
  } catch {
    try {
      await writeSyncChunks(store, store.stripBody(all || {}), true);
      console.warn(
        `[hypha] ${store.label} exceed Chrome sync quota — backed up the catalog (signatures) only. Use Export in the side panel for a full backup.`,
      );
    } catch (e2) {
      console.warn(`[hypha] ${store.label} sync mirror failed:`, e2);
    }
  }
}

async function readStoreFromSync(store: SyncStore): Promise<any | null> {
  if (!chrome.storage?.sync) return null;
  try {
    const meta = (await chrome.storage.sync.get(store.syncMeta))[store.syncMeta];
    if (!meta?.chunks) return null;
    const keys = Array.from({ length: meta.chunks }, (_, i) => store.syncPrefix + i);
    const got = await chrome.storage.sync.get(keys);
    let json = "";
    for (let i = 0; i < meta.chunks; i++) json += got[store.syncPrefix + i] || "";
    return JSON.parse(json);
  } catch (e) {
    console.warn(`[hypha] ${store.label} sync read failed:`, e);
    return null;
  }
}

/** On (re)install/startup: if the local store is empty but sync has a backup,
 *  restore it. Safe to call repeatedly. */
async function hydrateStoreFromSync(store: SyncStore): Promise<void> {
  try {
    const local = (await chrome.storage.local.get(store.localKey))[store.localKey] || {};
    if (Object.keys(local).length) return;
    const synced = await readStoreFromSync(store);
    if (synced && Object.keys(synced).length) {
      await chrome.storage.local.set({ [store.localKey]: synced });
      console.log(`[hypha] restored ${store.label} from sync backup`);
    }
  } catch (e) {
    console.warn(`[hypha] ${store.label} hydrate failed:`, e);
  }
}

// Skills durability wrappers (the SW wires these to storage.onChanged + startup).
export const mirrorSkillsToSync = (all: SkillStore) => mirrorStoreToSync(SKILLS_STORE, all);
export const hydrateSkillsFromSync = () => hydrateStoreFromSync(SKILLS_STORE);
/** Resolve the origin to scope a skill to: the explicitly-passed origin, else
 *  the current target tab's origin. Skills are always bound to an origin. */
async function siteFor(ctx: BrowserToolCtx, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const t = await chrome.tabs.get(await resolveTarget(ctx));
  return originOf(t.url) || t.url || "unknown";
}

/** A lightweight name+description index of an origin's skills (auto-surfaced on
 *  operation results so the agent reuses/records skills without an extra call). */
export async function skillIndexForOrigin(
  origin: string,
): Promise<{ name: string; description: string }[]> {
  const site = (await loadAllSkills())[origin] || {};
  return Object.entries(site).map(([name, e]) => ({
    name,
    description: normEntry(e).description,
  }));
}

// ---- per-site TOOLS (named, parameterized, callable scripts) -------------
// A site tool is a reusable JS recipe the agent defines once and CALLS by name
// with args, instead of re-sending a full execute_script every time. Stored per
// origin alongside (but separate from) site skills, with the same durability.
const TOOLS_KEY = "hyphaSiteTools";
type ToolParam = {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  default?: any;
};
type ToolEntry = { description: string; params: ToolParam[]; code: string };
// origin -> name -> entry
type ToolStore = Record<string, Record<string, ToolEntry>>;

/** Normalize a stored tool entry to a complete, well-typed shape. */
function normTool(e: any): ToolEntry {
  return {
    description: typeof e?.description === "string" ? e.description : "",
    params: normParams(e?.params),
    code: typeof e?.code === "string" ? e.code : "",
  };
}

/** Coerce params to an array of {name, type?, description?, required?, default?};
 *  drop entries without a usable name. */
function normParams(params: any): ToolParam[] {
  if (!Array.isArray(params)) return [];
  const out: ToolParam[] = [];
  for (const p of params) {
    if (!p || typeof p !== "object") continue;
    const name = String(p.name ?? "").trim();
    if (!name) continue;
    const param: ToolParam = { name };
    if (typeof p.type === "string") param.type = p.type;
    if (typeof p.description === "string") param.description = p.description;
    if (p.required) param.required = true;
    if ("default" in p) param.default = p.default;
    out.push(param);
  }
  return out;
}

async function loadAllTools(): Promise<ToolStore> {
  const r = await chrome.storage.local.get(TOOLS_KEY);
  return r[TOOLS_KEY] || {};
}
async function saveAllTools(all: ToolStore): Promise<void> {
  await chrome.storage.local.set({ [TOOLS_KEY]: all });
}

const TOOLS_STORE: SyncStore = {
  localKey: TOOLS_KEY,
  syncMeta: "hyphaToolsMeta",
  syncPrefix: "hyphaToolsChunk",
  label: "site tools",
  stripBody: (all) => {
    const out: ToolStore = {};
    for (const [o, site] of Object.entries(all || {})) {
      out[o] = {};
      for (const [n, e] of Object.entries(site as any)) {
        const t = normTool(e);
        out[o][n] = { description: t.description, params: t.params, code: "" };
      }
    }
    return out;
  },
};
// Tools durability wrappers (wired by the SW, exactly like the skills ones).
export const mirrorToolsToSync = (all: ToolStore) => mirrorStoreToSync(TOOLS_STORE, all);
export const hydrateToolsFromSync = () => hydrateStoreFromSync(TOOLS_STORE);

/** A lightweight SIGNATURE index of an origin's tools (name + description +
 *  params), auto-surfaced on operation results — never includes the code body. */
export async function toolIndexForOrigin(
  origin: string,
): Promise<{ name: string; description: string; params: ToolParam[] }[]> {
  const site = (await loadAllTools())[origin] || {};
  return Object.entries(site).map(([name, e]) => {
    const t = normTool(e);
    return { name, description: t.description, params: t.params };
  });
}

/** Validate call args against a tool's params: ensure required ones are present,
 *  apply defaults for missing optional ones. Extra args pass through (flexible). */
function buildCallArgs(
  params: ToolParam[],
  args: any,
): { ok: true; args: Record<string, any> } | { ok: false; error: string } {
  const provided = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const out: Record<string, any> = { ...provided };
  const missing: string[] = [];
  for (const p of params) {
    if (out[p.name] === undefined) {
      if ("default" in p) out[p.name] = p.default;
      else if (p.required) missing.push(p.name);
    }
  }
  if (missing.length) {
    return { ok: false, error: `Missing required argument(s): ${missing.join(", ")}.` };
  }
  return { ok: true, args: out };
}

export const BROWSER_TOOLS: Record<string, Tool> = {
  list_tabs: {
    schema: {
      name: "list_tabs",
      description:
        "List all open browser tabs across windows. Returns id, title, url, active, window_id, status. Use the id with activate_tab / close_tab / navigate.",
      parameters: { type: "object", properties: {} },
    },
    run: async () => (await chrome.tabs.query({})).map(tabSummary),
  },

  get_active_tab: {
    schema: {
      name: "get_active_tab",
      description:
        "Get the currently targeted tab (the tab that page-level tools act on). Defaults to the browser's active tab.",
      parameters: { type: "object", properties: {} },
    },
    run: async (ctx) => {
      const id = await resolveTarget(ctx);
      return tabSummary(await chrome.tabs.get(id));
    },
  },

  open_tab: {
    schema: {
      name: "open_tab",
      description:
        "Open a NEW tab at a URL and make it the target for page-level tools. Returns the new tab. Prefer `navigate(url)` to reuse the current target tab — use open_tab only when you genuinely need a separate/additional tab open at the same time. Remember to `close_tab` extra tabs when you're done with them.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to open (include https://)" },
          focus: { type: "boolean", description: "Focus the new tab (default true)" },
        },
        required: ["url"],
      },
    },
    run: async (ctx, [url, focus = true]) => {
      // In force-background mode, never steal focus — open the tab inactive.
      const active = ctx.forceBackground?.() ? false : !!focus;
      const t = await chrome.tabs.create({ url, active });
      ctx.setTarget(t.id);
      // A freshly-created tab's URL hasn't committed yet, so t.url is "" and the
      // derived origin would be empty — fall back to the requested URL.
      return tabSummary({ ...t, url: t.url || url });
    },
  },

  close_tab: {
    schema: {
      name: "close_tab",
      description:
        "Close a tab by id. Use this to clean up EXTRA tabs you opened with open_tab once you're done with them, so tabs don't pile up. Get ids from list_tabs.",
      parameters: {
        type: "object",
        properties: { tab_id: { type: "number", description: "Tab id to close" } },
        required: ["tab_id"],
      },
    },
    run: async (_ctx, [tab_id]) => {
      await chrome.tabs.remove(tab_id);
      return { success: true };
    },
  },

  activate_tab: {
    schema: {
      name: "activate_tab",
      description:
        "Make a tab the target for page-level tools (get_browser_state, click_element_by_index, screenshot, …). By default it also brings the tab to the front; in 'work in background' mode it just retargets without stealing focus.",
      parameters: {
        type: "object",
        properties: { tab_id: { type: "number", description: "Tab id to target" } },
        required: ["tab_id"],
      },
    },
    run: async (ctx, [tab_id]) => {
      const bg = ctx.forceBackground?.();
      if (!bg) {
        // Default: bring the tab to the front and focus its window.
        const t = await chrome.tabs.get(tab_id);
        await chrome.tabs.update(tab_id, { active: true });
        try {
          await chrome.windows.update(t.windowId, { focused: true });
        } catch {
          /* ignore */
        }
      }
      // In background mode, just retarget — don't activate the tab or focus the
      // window, so the user isn't interrupted.
      ctx.setTarget(tab_id);
      return { success: true, background: !!bg, tab: tabSummary(await chrome.tabs.get(tab_id)) };
    },
  },

  navigate: {
    schema: {
      name: "navigate",
      description:
        "Navigate the current target tab to a URL (full page load) — REUSES the existing tab, so this is the preferred way to move between pages. Use open_tab only when you need a separate tab.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "URL to navigate to" } },
        required: ["url"],
      },
    },
    run: async (ctx, [url]) => {
      const id = await resolveTarget(ctx);
      await chrome.tabs.update(id, { url });
      return { success: true, url };
    },
  },

  reload_tab: {
    schema: {
      name: "reload_tab",
      description: "Reload the target tab.",
      parameters: {
        type: "object",
        properties: {
          bypass_cache: { type: "boolean", description: "Hard reload (default false)" },
        },
      },
    },
    run: async (ctx, [bypass_cache = false]) => {
      const id = await resolveTarget(ctx);
      await chrome.tabs.reload(id, { bypassCache: !!bypass_cache });
      return { success: true };
    },
  },

  go_back: {
    schema: {
      name: "go_back",
      description: "Go back in the target tab's history.",
      parameters: { type: "object", properties: {} },
    },
    run: async (ctx) => {
      await chrome.tabs.goBack(await resolveTarget(ctx));
      return { success: true };
    },
  },

  go_forward: {
    schema: {
      name: "go_forward",
      description: "Go forward in the target tab's history.",
      parameters: { type: "object", properties: {} },
    },
    run: async (ctx) => {
      await chrome.tabs.goForward(await resolveTarget(ctx));
      return { success: true };
    },
  },

  execute_script: {
    schema: {
      name: "execute_script",
      description:
        "Run arbitrary JavaScript in the target tab's page context and return the result. Uses the Chrome debugger (Page.setBypassCSP), so it works even on strict-CSP pages that block 'unsafe-eval'. The last expression is auto-returned; async code is awaited. Attaching shows Chrome's 'debugging this browser' banner.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "JavaScript to execute" } },
        required: ["code"],
      },
    },
    run: async (ctx, [code]) => cdpEval(await resolveTarget(ctx), String(code ?? "")),
  },

  take_screenshot: {
    schema: {
      name: "take_screenshot",
      description:
        "Capture a screenshot of the target tab via the Chrome debugger (Page.captureScreenshot) — works reliably even when the tab is NOT in the foreground (unlike DOM-rasterizing approaches that stall on background tabs). Capture the viewport, a specific element (selector), or the full page. Downscaled to fit max_width × max_height (default 800px) and JPEG-encoded at quality 0.6 by default. Returns { base64, media_type, data_url, format, width, height, size_kb }. Use `base64` (raw, no prefix) directly with Claude/GPT image content fields; `data_url` for HTML <img src=...> previews. On failure returns { error }.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the element to capture. Omit for the viewport (or full page if full_page=true)." },
          format: { type: "string", enum: ["png", "jpeg"], description: "Image format. Default: jpeg (smaller). Use png only when sharp text matters." },
          quality: { type: "number", description: "JPEG quality 0–1. Default 0.6. Ignored for PNG." },
          max_width: { type: "number", description: "Max output width in px. Default 800. Scaled down preserving aspect ratio." },
          max_height: { type: "number", description: "Max output height in px. Default 800. Scaled down preserving aspect ratio." },
          full_page: { type: "boolean", description: "If true, capture the entire scrollable page instead of just the viewport. Default false." },
        },
      },
    },
    run: async (ctx, [selector, format, quality, max_width, max_height, full_page]) =>
      cdpScreenshot(await resolveTarget(ctx), { selector, format, quality, max_width, max_height, full_page }),
  },

  // ---- skill memory (accumulate per-origin know-how across sessions) ------
  // Every skill is BOUND TO A SITE ORIGIN and identified by a NAME. Listing
  // returns name + description; the name is the key to read the full content.
  list_site_skills: {
    schema: {
      name: "list_site_skills",
      description:
        "List saved site skills grouped BY SITE ORIGIN. Each skill is a markdown note about one operation type (search, export, create, login, …) learned in past sessions. Returns each skill's NAME and DESCRIPTION (not the full content) — read the full markdown with get_site_skill(origin, name). With no argument, returns every origin with its skills. Pass `origin` to list just that site's. Call this FIRST when you start on a site so you reuse skills instead of re-exploring.",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description:
              "Site origin, e.g. https://example.com (from tab/browser info). Omit to list all origins.",
          },
        },
      },
    },
    run: async (_ctx, [origin]) => {
      const all = await loadAllSkills();
      const indexOf = (o: string) =>
        Object.entries(all[o] || {}).map(([name, e]) => ({
          name,
          description: normEntry(e).description,
        }));
      if (origin) {
        const skills = indexOf(String(origin));
        return { origin: String(origin), skills, count: skills.length };
      }
      const sites: Record<string, { name: string; description: string }[]> = {};
      for (const o of Object.keys(all)) sites[o] = indexOf(o);
      return { sites, site_count: Object.keys(sites).length };
    },
  },

  get_site_skill: {
    schema: {
      name: "get_site_skill",
      description:
        "Read one saved site skill — returns it as an agentskills.io SKILL.md (frontmatter + body) plus the separate description and content. Pass the site `origin` and the skill `name` (both from list_site_skills; the origin is also in tab/browser info). Read before updating so you extend rather than overwrite it.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Site origin, e.g. https://example.com" },
          name: { type: "string", description: "Skill name (the key from list_site_skills)" },
        },
        required: ["origin", "name"],
      },
    },
    run: async (ctx, [origin, name]) => {
      const o = await siteFor(ctx, origin);
      const site = (await loadAllSkills())[o] || {};
      const raw = site[String(name)];
      if (raw == null) {
        const available = Object.keys(site);
        return {
          origin: o,
          name,
          found: false,
          available,
          hint: available.length
            ? `No skill named '${name}' for ${o}. Available: ${available.join(", ")}. Use list_site_skills(origin) to see names + descriptions.`
            : `No skills saved for ${o} yet. Explore, then save one with set_site_skill(origin, name, description, content).`,
        };
      }
      const e = normEntry(raw);
      return {
        origin: o,
        name,
        found: true,
        description: e.description,
        content: e.content,
        skill_md: toSkillMd(String(name), e),
      };
    },
  },

  set_site_skill: {
    schema: {
      name: "set_site_skill",
      description:
        "Save or update a site skill — an Agent Skill (agentskills.io) BOUND TO A SITE ORIGIN. It captures your experience doing ONE type of operation on this site (e.g. searching, exporting a report, creating an item, logging in). Provide: `name` — the skill name / key, 1-64 chars, lowercase letters/numbers/hyphens (e.g. 'search', 'export-report'); `description` — one line (≤1024 chars) saying what it does and when to use it (shown in list_site_skills); `content` — the markdown SKILL.md body: what works, the execute_script JS snippet or discovered API endpoint+params, key selectors/element indices, the steps, and gotchas. Pass `origin` (from tab/browser info) so it's stored under the right site; defaults to the current target tab's origin. A site can have many skills. To update, read the entry, edit, and set it again under the same name.",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Site origin to bind this skill to. Defaults to the current tab's origin.",
          },
          name: { type: "string", description: "Skill name / key: 1-64 chars, lowercase a-z, 0-9, hyphens (e.g. 'export-report')" },
          description: { type: "string", description: "One line (≤1024 chars): what the skill does and when to use it" },
          content: { type: "string", description: "SKILL.md markdown body: how to do this operation (recipe, JS/API, selectors, steps, gotchas)" },
        },
        required: ["name", "description", "content"],
      },
    },
    run: async (ctx, [origin, name, description, content]) => {
      const o = await siteFor(ctx, origin);
      const nm = normName(name);
      if (!nm) {
        return {
          success: false,
          error:
            "Invalid skill name. Use 1-64 chars: lowercase letters, numbers and single hyphens, e.g. 'export-report'.",
        };
      }
      const desc = String(description ?? "").replace(/\r?\n/g, " ").trim().slice(0, 1024);
      if (!desc) {
        return { success: false, error: "A non-empty `description` is required (≤1024 chars)." };
      }
      const all = await loadAllSkills();
      all[o] = all[o] || {};
      const renamed = nm !== String(name);
      all[o][nm] = { description: desc, content: String(content ?? "") };
      await saveAllSkills(all);
      return {
        success: true,
        origin: o,
        name: nm,
        ...(renamed ? { note: `name normalized to '${nm}' (agentskills naming rules)` } : {}),
        count: Object.keys(all[o]).length,
      };
    },
  },

  remove_site_skill: {
    schema: {
      name: "remove_site_skill",
      description:
        "Delete an outdated skill entry. Pass the site `origin` (from tab/browser info) and the skill `name`.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Site origin the skill is bound to" },
          name: { type: "string", description: "Skill name to delete" },
        },
        required: ["origin", "name"],
      },
    },
    run: async (ctx, [origin, name]) => {
      const o = await siteFor(ctx, origin);
      const all = await loadAllSkills();
      const had = !!(all[o] && String(name) in all[o]);
      if (all[o]) delete all[o][String(name)];
      await saveAllSkills(all);
      return { success: true, origin: o, name, removed: had };
    },
  },

  // ---- site tools (named, parameterized, CALLABLE scripts per origin) -----
  // Define a recipe once with set_site_tool, then call_site_tool(origin, name,
  // args) instead of re-sending execute_script. Tools are mutated by saving over
  // the same name. Separate store from skills (markdown know-how), both per-origin.
  list_site_tools: {
    schema: {
      name: "list_site_tools",
      description:
        "List saved site tools grouped BY SITE ORIGIN. A site tool is a named, parameterized JS recipe you can CALL by name with args (via call_site_tool) instead of re-sending execute_script. Returns each tool's NAME, DESCRIPTION and PARAMS signature (not the code body) — read the code with get_site_tool(origin, name). With no argument, returns every origin. Pass `origin` to list just that site's. Call this FIRST on a site so you reuse tools instead of rewriting scripts.",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description:
              "Site origin, e.g. https://example.com (from tab/browser info). Omit to list all origins.",
          },
        },
      },
    },
    run: async (_ctx, [origin]) => {
      const all = await loadAllTools();
      const sigOf = (o: string) =>
        Object.entries(all[o] || {}).map(([name, e]) => {
          const t = normTool(e);
          return { name, description: t.description, params: t.params };
        });
      if (origin) {
        const tools = sigOf(String(origin));
        return { origin: String(origin), tools, count: tools.length };
      }
      const sites: Record<string, ReturnType<typeof sigOf>> = {};
      for (const o of Object.keys(all)) sites[o] = sigOf(o);
      return { sites, site_count: Object.keys(sites).length };
    },
  },

  get_site_tool: {
    schema: {
      name: "get_site_tool",
      description:
        "Read one saved site tool — returns its description, params signature, and the full code body. Pass the site `origin` and the tool `name` (both from list_site_tools). Read before updating so you extend rather than overwrite it.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Site origin, e.g. https://example.com" },
          name: { type: "string", description: "Tool name (the key from list_site_tools)" },
        },
        required: ["origin", "name"],
      },
    },
    run: async (ctx, [origin, name]) => {
      const o = await siteFor(ctx, origin);
      const site = (await loadAllTools())[o] || {};
      const raw = site[String(name)];
      if (raw == null) {
        const available = Object.keys(site);
        return {
          origin: o,
          name,
          found: false,
          available,
          hint: available.length
            ? `No tool named '${name}' for ${o}. Available: ${available.join(", ")}.`
            : `No tools saved for ${o} yet. Define one with set_site_tool(origin, name, description, params, code).`,
        };
      }
      const t = normTool(raw);
      return { origin: o, name, found: true, description: t.description, params: t.params, code: t.code };
    },
  },

  set_site_tool: {
    schema: {
      name: "set_site_tool",
      description:
        "Save or update a site tool BOUND TO A SITE ORIGIN: a named, parameterized JS recipe you can later CALL by name. Provide: `name` — 1-64 chars, lowercase letters/numbers/hyphens (e.g. 'search', 'export-report'); `description` — one line (what it does / when to use); `params` — an array of parameter specs `{name, type?, description?, required?, default?}` describing the call arguments; `code` — the JS body to run, with an `args` object IN SCOPE (the call arguments) and whose LAST EXPRESSION is auto-returned (async/await supported, e.g. `await fetch(...)`). Pass `origin` (from tab/browser info); defaults to the current target tab. Saving over the same name mutates the tool. Then run it with call_site_tool(origin, name, args).",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Site origin to bind this tool to. Defaults to the current tab's origin.",
          },
          name: { type: "string", description: "Tool name / key: 1-64 chars, lowercase a-z, 0-9, hyphens" },
          description: { type: "string", description: "One line: what the tool does and when to use it" },
          params: {
            type: "array",
            description:
              "Parameter specs: array of {name, type?, description?, required?, default?}. These become the `args` keys at call time.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Parameter name (becomes an `args` key)" },
                type: { type: "string", description: "Optional JSON type hint, e.g. string/number/boolean" },
                description: { type: "string", description: "What the parameter is for" },
                required: { type: "boolean", description: "Whether the caller must supply it" },
                default: { description: "Default value used when the caller omits it" },
              },
              required: ["name"],
            },
          },
          code: {
            type: "string",
            description:
              "JS body to execute. The call arguments are available as `args` (an object). The last expression is auto-returned; async/await is supported.",
          },
        },
        required: ["name", "description", "code"],
      },
    },
    run: async (ctx, [origin, name, description, params, code]) => {
      const o = await siteFor(ctx, origin);
      const nm = normName(name);
      if (!nm) {
        return {
          success: false,
          error:
            "Invalid tool name. Use 1-64 chars: lowercase letters, numbers and single hyphens, e.g. 'export-report'.",
        };
      }
      const desc = String(description ?? "").replace(/\r?\n/g, " ").trim().slice(0, 1024);
      if (!desc) return { success: false, error: "A non-empty `description` is required (≤1024 chars)." };
      const body = String(code ?? "");
      if (!body.trim()) return { success: false, error: "A non-empty `code` body is required." };
      const all = await loadAllTools();
      all[o] = all[o] || {};
      const renamed = nm !== String(name);
      all[o][nm] = { description: desc, params: normParams(params), code: body };
      await saveAllTools(all);
      return {
        success: true,
        origin: o,
        name: nm,
        params: all[o][nm].params,
        ...(renamed ? { note: `name normalized to '${nm}' (naming rules)` } : {}),
        count: Object.keys(all[o]).length,
      };
    },
  },

  remove_site_tool: {
    schema: {
      name: "remove_site_tool",
      description:
        "Delete an outdated site tool. Pass the site `origin` (from tab/browser info) and the tool `name`.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Site origin the tool is bound to" },
          name: { type: "string", description: "Tool name to delete" },
        },
        required: ["origin", "name"],
      },
    },
    run: async (ctx, [origin, name]) => {
      const o = await siteFor(ctx, origin);
      const all = await loadAllTools();
      const had = !!(all[o] && String(name) in all[o]);
      if (all[o]) delete all[o][String(name)];
      await saveAllTools(all);
      return { success: true, origin: o, name, removed: had };
    },
  },

  call_site_tool: {
    schema: {
      name: "call_site_tool",
      description:
        "CALL a saved site tool by name with arguments — the fast path: runs the tool's stored code (no script re-sent), with your `args` injected in scope, on the current target tab. Validates required params and applies defaults. Pass the site `origin` (from tab/browser info; defaults to the current tab), the tool `name`, and `args` (an object of argument name→value). Returns {result, type} like execute_script, or {error}.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Site origin the tool is bound to. Defaults to the current tab's origin." },
          name: { type: "string", description: "Tool name to call (from list_site_tools)" },
          args: {
            type: "object",
            additionalProperties: true,
            description: "Arguments object passed to the tool as `args` (keys are the tool's param names).",
          },
        },
        required: ["name"],
      },
    },
    run: async (ctx, [origin, name, args]) => {
      const o = await siteFor(ctx, origin);
      const site = (await loadAllTools())[o] || {};
      const raw = site[String(name)];
      if (raw == null) {
        const available = Object.keys(site);
        return {
          error: available.length
            ? `No tool named '${name}' for ${o}. Available: ${available.join(", ")}. Use list_site_tools(origin).`
            : `No tools saved for ${o} yet. Define one with set_site_tool(origin, name, description, params, code).`,
        };
      }
      const t = normTool(raw);
      const built = buildCallArgs(t.params, args);
      if (!built.ok) return { error: built.error };
      return cdpEval(await resolveTarget(ctx), t.code, built.args);
    },
  },
};

export const BROWSER_TOOL_NAMES = new Set(Object.keys(BROWSER_TOOLS));
