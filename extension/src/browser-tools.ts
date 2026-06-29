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

import { autoReturn } from "../../javascript/src/services/execute.js";

export interface BrowserToolCtx {
  getTarget: () => number | null;
  setTarget: (tabId: number) => void;
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

async function cdpEval(tabId: number, code: string): Promise<any> {
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
  const expression = `(async () => { ${autoReturn(code)} })()`;
  const res: any = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
    replMode: true,
  });
  if (res?.exceptionDetails) {
    const ex = res.exceptionDetails;
    return { error: ex.exception?.description || ex.exception?.value || ex.text || "Evaluation error" };
  }
  const r = res?.result || {};
  return { result: r.value !== undefined ? r.value : r.description ?? null, type: r.type };
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
const SYNC_META = "hyphaSkillsMeta";
const SYNC_PREFIX = "hyphaSkillsChunk";
const SYNC_CHUNK = 7000;

async function writeSyncChunks(obj: any, partial: boolean): Promise<void> {
  const json = JSON.stringify(obj || {});
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += SYNC_CHUNK) chunks.push(json.slice(i, i + SYNC_CHUNK));
  const prev = (await chrome.storage.sync.get(SYNC_META))[SYNC_META];
  const prevN = prev?.chunks || 0;
  const set: any = { [SYNC_META]: { chunks: chunks.length, partial } };
  chunks.forEach((c, i) => (set[SYNC_PREFIX + i] = c));
  await chrome.storage.sync.set(set);
  if (prevN > chunks.length) {
    const rm: string[] = [];
    for (let i = chunks.length; i < prevN; i++) rm.push(SYNC_PREFIX + i);
    await chrome.storage.sync.remove(rm);
  }
}

/** Catalog-only view: keep each skill's name + description, drop the body. */
function catalogOnly(all: SkillStore): SkillStore {
  const out: SkillStore = {};
  for (const [o, site] of Object.entries(all || {})) {
    out[o] = {};
    for (const [n, e] of Object.entries(site)) out[o][n] = { description: normEntry(e).description, content: "" };
  }
  return out;
}

/**
 * Mirror the skill store into chrome.storage.sync (best-effort, account-backed so
 * it survives reinstall). Full SKILL.md bodies can exceed sync's ~100KB quota; if
 * so, fall back to backing up the catalog (names + descriptions) only — the full
 * content stays in local (unlimitedStorage) and is portable via Export/Import.
 */
export async function mirrorSkillsToSync(all: SkillStore): Promise<void> {
  if (!chrome.storage?.sync) return;
  try {
    await writeSyncChunks(all || {}, false);
  } catch {
    try {
      await writeSyncChunks(catalogOnly(all || {}), true);
      console.warn(
        "[hypha] site skills exceed Chrome sync quota — backed up the catalog (names + descriptions) only. Use Export in the side panel for a full backup.",
      );
    } catch (e2) {
      console.warn("[hypha] skill sync mirror failed:", e2);
    }
  }
}

async function readSkillsFromSync(): Promise<SkillStore | null> {
  if (!chrome.storage?.sync) return null;
  try {
    const meta = (await chrome.storage.sync.get(SYNC_META))[SYNC_META];
    if (!meta?.chunks) return null;
    const keys = Array.from({ length: meta.chunks }, (_, i) => SYNC_PREFIX + i);
    const got = await chrome.storage.sync.get(keys);
    let json = "";
    for (let i = 0; i < meta.chunks; i++) json += got[SYNC_PREFIX + i] || "";
    return JSON.parse(json);
  } catch (e) {
    console.warn("[hypha] skill sync read failed:", e);
    return null;
  }
}

/** On (re)install/startup: if local skills are empty but sync has a backup,
 *  restore it. Safe to call repeatedly. */
export async function hydrateSkillsFromSync(): Promise<void> {
  try {
    const local = await loadAllSkills();
    if (Object.keys(local).length) return;
    const synced = await readSkillsFromSync();
    if (synced && Object.keys(synced).length) {
      await chrome.storage.local.set({ [SKILLS_KEY]: synced });
      console.log("[hypha] restored site skills from sync backup");
    }
  } catch (e) {
    console.warn("[hypha] skill hydrate failed:", e);
  }
}
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
        "Open a new tab at a URL and make it the target for page-level tools. Returns the new tab.",
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
      const t = await chrome.tabs.create({ url, active: !!focus });
      ctx.setTarget(t.id);
      return tabSummary(t);
    },
  },

  close_tab: {
    schema: {
      name: "close_tab",
      description: "Close a tab by id.",
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
        "Focus a tab by id and make it the target for page-level tools (get_browser_state, click_element_by_index, screenshot, …).",
      parameters: {
        type: "object",
        properties: { tab_id: { type: "number", description: "Tab id to target" } },
        required: ["tab_id"],
      },
    },
    run: async (ctx, [tab_id]) => {
      const t = await chrome.tabs.get(tab_id);
      await chrome.tabs.update(tab_id, { active: true });
      try {
        await chrome.windows.update(t.windowId, { focused: true });
      } catch {
        /* ignore */
      }
      ctx.setTarget(tab_id);
      return { success: true, tab: tabSummary(await chrome.tabs.get(tab_id)) };
    },
  },

  navigate: {
    schema: {
      name: "navigate",
      description:
        "Navigate the target tab to a URL (full page load). Use open_tab to navigate in a new tab instead.",
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
};

export const BROWSER_TOOL_NAMES = new Set(Object.keys(BROWSER_TOOLS));
