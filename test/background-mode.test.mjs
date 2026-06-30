/**
 * Tests for "work in background" mode (ctx.forceBackground): tab tools must never
 * steal focus when it's on. open_tab opens the tab inactive; activate_tab
 * retargets WITHOUT activating the tab or focusing its window. Default behavior
 * (focus on) is unchanged.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

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
  const out = resolve(HERE, ".tmp-bg.mjs");
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

function harness(forceBackground) {
  const calls = { create: null, tabUpdates: [], winUpdates: [] };
  globalThis.chrome = {
    tabs: {
      create: async ({ url, active }) => {
        calls.create = { url, active };
        return { id: 99, url: "", title: "", active, windowId: 1, status: "loading" };
      },
      get: async (id) => ({ id, url: "https://site.example/p", windowId: 1, title: "t", active: true, status: "complete" }),
      update: async (id, props) => calls.tabUpdates.push({ id, props }),
    },
    windows: { update: async (wid, props) => calls.winUpdates.push({ wid, props }) },
  };
  let target = null;
  const ctx = {
    getTarget: () => target,
    setTarget: (id) => (target = id),
    forceBackground: () => forceBackground,
  };
  return { ctx, calls, getTarget: () => target };
}

test("open_tab opens INACTIVE in background mode even when focus=true", async () => {
  const { ctx, calls, getTarget } = harness(true);
  const r = await mod.BROWSER_TOOLS.open_tab.run(ctx, ["https://site.example/p", true]);
  assert.equal(calls.create.active, false, "tab must be created inactive in bg mode");
  assert.equal(getTarget(), 99); // still retargeted
  assert.equal(r.origin, "https://site.example");
});

test("open_tab honors focus normally when background mode is off", async () => {
  const { ctx, calls } = harness(false);
  await mod.BROWSER_TOOLS.open_tab.run(ctx, ["https://site.example/p", true]);
  assert.equal(calls.create.active, true);
});

test("activate_tab retargets WITHOUT focusing in background mode", async () => {
  const { ctx, calls, getTarget } = harness(true);
  const r = await mod.BROWSER_TOOLS.activate_tab.run(ctx, [99]);
  assert.equal(calls.tabUpdates.length, 0, "must not call tabs.update({active:true}) in bg mode");
  assert.equal(calls.winUpdates.length, 0, "must not focus the window in bg mode");
  assert.equal(getTarget(), 99); // still becomes the target
  assert.equal(r.background, true);
  assert.equal(r.success, true);
});

test("activate_tab focuses the tab + window normally when background mode is off", async () => {
  const { ctx, calls } = harness(false);
  const r = await mod.BROWSER_TOOLS.activate_tab.run(ctx, [99]);
  assert.deepEqual(calls.tabUpdates, [{ id: 99, props: { active: true } }]);
  assert.equal(calls.winUpdates.length, 1);
  assert.equal(calls.winUpdates[0].props.focused, true);
  assert.equal(r.background, false);
});
