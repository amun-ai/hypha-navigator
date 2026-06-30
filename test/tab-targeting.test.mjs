/**
 * Per-call tab_id targeting (Option A): a call may target a SPECIFIC tab without
 * changing the shared default target, so multiple agents can each drive their own
 * tab. Page tools get an injected leading tab_id (stripped+routed by the SW);
 * execute_script/take_screenshot/navigate/history take it explicitly.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

let mod;
before(async () => {
  const tsResolve = {
    name: "ts-resolve",
    setup(b) {
      b.onResolve({ filter: /\.js$/ }, (args) => {
        if (args.kind === "entry-point" || !args.path.startsWith(".")) return;
        const ts = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
        return existsSync(ts) ? { path: ts } : null;
      });
    },
  };
  const out = resolve(HERE, ".tmp-tabtarget.mjs");
  await build({
    entryPoints: [resolve(ROOT, "src/browser-tools.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: false,
    nodePaths: [resolve(ROOT, "node_modules")],
    plugins: [tsResolve],
    logLevel: "warning",
  });
  mod = await import(pathToFileURL(out).href);
});

let attachedTo;
function installChrome() {
  attachedTo = [];
  const updates = [];
  globalThis.__updates = updates;
  globalThis.chrome = {
    tabs: {
      get: async (id) => ({ id, url: "https://x.example/", windowId: 1, title: "t", active: true, status: "complete" }),
      update: async (id, props) => updates.push({ id, props }),
      query: async () => [{ id: 7, url: "https://x.example/" }],
    },
    debugger: {
      attach: async ({ tabId }) => attachedTo.push(tabId),
      detach: async () => {},
      sendCommand: async (_t, method) => {
        if (method === "Runtime.evaluate") return { result: { value: 2, type: "number" } };
        if (method === "Page.getLayoutMetrics")
          return { cssContentSize: { width: 100, height: 100 }, cssVisualViewport: { clientWidth: 100, clientHeight: 100 } };
        if (method === "Page.captureScreenshot") return { data: "QQ==" };
        return {};
      },
    },
  };
}

const CTX = { getTarget: () => 7, setTarget() {} };

test("splitTabId pulls a leading numeric tab_id, leaving the rest", () => {
  const { splitTabId } = mod;
  assert.deepEqual(splitTabId([5, "code"]), { tabId: 5, rest: ["code"] });
  assert.deepEqual(splitTabId([undefined, "code"]), { tabId: null, rest: ["code"] }); // tab_id omitted
  assert.deepEqual(splitTabId([]), { tabId: null, rest: [] });
});

test("execute_script runs in the given tab_id, else the default target", async () => {
  installChrome();
  await mod.detachAll();
  await mod.BROWSER_TOOLS.execute_script.run(CTX, [42, "1+1"]); // explicit tab
  assert.ok(attachedTo.includes(42), "should attach to the passed tab_id");

  await mod.detachAll();
  installChrome();
  await mod.BROWSER_TOOLS.execute_script.run(CTX, [undefined, "1+1"]); // no tab_id
  assert.ok(attachedTo.includes(7), "should fall back to the default target (ctx.getTarget)");
});

test("navigate updates the given tab_id without touching the default target", async () => {
  installChrome();
  await mod.BROWSER_TOOLS.navigate.run(CTX, [88, "https://dest.example/p"]);
  assert.deepEqual(globalThis.__updates.at(-1), { id: 88, props: { url: "https://dest.example/p" } });

  await mod.BROWSER_TOOLS.navigate.run(CTX, [undefined, "https://dest.example/q"]);
  assert.equal(globalThis.__updates.at(-1).id, 7); // default target
});

test("take_screenshot captures the given tab_id", async () => {
  installChrome();
  await mod.detachAll();
  const r = await mod.BROWSER_TOOLS.take_screenshot.run(CTX, [55, undefined, "jpeg", 0.6, 800, 800, false]);
  assert.equal(r.base64, "QQ==");
  assert.ok(attachedTo.includes(55));
});

test("INVARIANT holds: tab_id is first in both schema and run for the updated tools", () => {
  for (const name of ["execute_script", "take_screenshot", "navigate", "reload_tab", "go_back", "go_forward"]) {
    const props = Object.keys(mod.BROWSER_TOOLS[name].schema.parameters.properties);
    assert.equal(props[0], "tab_id", `${name} schema must list tab_id first`);
    assert.match(mod.BROWSER_TOOLS[name].run.toString(), /\(\s*ctx\s*,\s*\[\s*tab_id/, `${name} run must destructure tab_id first`);
  }
});

// ---- source guards for the SW routing + catalog injection ----------------
test("buildCatalog injects tab_id as the FIRST property of page-tool schemas", () => {
  const src = read("src/service-catalog.ts");
  assert.match(src, /const TAB_ID_PROP = \{\s*tab_id:/);
  // injected first: { ...TAB_ID_PROP, ...originalProperties }
  assert.match(src, /properties: \{ \.\.\.TAB_ID_PROP, \.\.\.\(schema\.parameters\?\.properties \|\| \{\}\) \}/);
  assert.match(src, /withTabId\(e\.schema\)/);
});

test("SW strips the page tab_id and forwards the rest to the content script", () => {
  const src = read("src/background.ts");
  assert.match(src, /splitTabId\(args \|\| \[\]\)/);
  assert.match(src, /__hyphaPage: true, method, args: rest, showHighlights/, "must forward args WITHOUT the tab_id");
  // explicit tab_id must NOT repoint the default target (no setTarget on that path)
  assert.match(src, /actedTab = tabId/);
});
