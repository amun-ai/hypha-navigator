/**
 * Mock-chrome tests for the per-site TOOLS feature (src/browser-tools.ts): CRUD,
 * signature-only listing, the durable chrome.storage.sync round-trip (separate
 * keys from skills), and call_site_tool — required-arg validation, default
 * application, and the args-injection CDP path (returnByValue + awaitPromise,
 * never replMode). browser-tools pulls in shared sources via ".js" specifiers, so
 * we bundle it with esbuild (the build's .js→.ts resolver) and inject a chrome mock.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function makeArea() {
  const store = new Map();
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    _store: store,
    async get(keys) {
      if (keys == null) {
        const o = {};
        for (const [k, v] of store) o[k] = clone(v);
        return o;
      }
      const arr = Array.isArray(keys) ? keys : [keys];
      const o = {};
      for (const k of arr) if (store.has(k)) o[k] = clone(store.get(k));
      return o;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) store.set(k, clone(v));
    },
    async remove(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
    },
  };
}

let evalCalls = [];
function installChrome() {
  evalCalls = [];
  globalThis.chrome = {
    storage: { local: makeArea(), sync: makeArea() },
    tabs: { get: async (id) => ({ id, url: "https://shop.example/cart" }) },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_target, method, params) => {
        if (method === "Runtime.evaluate") {
          evalCalls.push(params);
          return { result: { value: { ok: true }, type: "object" } };
        }
        return {};
      },
    },
  };
}

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
  const out = resolve(HERE, ".tmp-site-tools.mjs");
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

const CTX = { setTarget() {}, getTarget: () => 7 };
const ORIGIN = "https://shop.example";

test("set/get/list/remove site tool: signature in list, code only in get; name normalized", async () => {
  installChrome();
  const { BROWSER_TOOLS, toolIndexForOrigin } = mod;

  const set = await BROWSER_TOOLS.set_site_tool.run(CTX, [
    ORIGIN,
    "Add To Cart!", // not slug-safe → normalized
    "Add a product to the cart by id",
    [{ name: "sku", type: "string", required: true }, { name: "qty", default: 1 }],
    "return await fetch('/api/cart', {method:'POST', body: JSON.stringify(args)})",
  ]);
  assert.equal(set.success, true);
  assert.equal(set.name, "add-to-cart");
  assert.equal(set.count, 1);
  assert.deepEqual(set.params.map((p) => p.name), ["sku", "qty"]);

  // list returns SIGNATURE only — no code body
  const list = await BROWSER_TOOLS.list_site_tools.run(CTX, [ORIGIN]);
  assert.equal(list.count, 1);
  assert.equal(list.tools[0].name, "add-to-cart");
  assert.deepEqual(Object.keys(list.tools[0]).sort(), ["description", "name", "params"]);
  assert.equal("code" in list.tools[0], false);

  // get returns the code body
  const got = await BROWSER_TOOLS.get_site_tool.run(CTX, [ORIGIN, "add-to-cart"]);
  assert.equal(got.found, true);
  assert.match(got.code, /fetch\('\/api\/cart'/);
  assert.equal(got.params[1].default, 1);

  // index helper (used by SW augmentation) returns signatures
  assert.deepEqual(await toolIndexForOrigin(ORIGIN), [
    { name: "add-to-cart", description: "Add a product to the cart by id", params: got.params },
  ]);

  const rm = await BROWSER_TOOLS.remove_site_tool.run(CTX, [ORIGIN, "add-to-cart"]);
  assert.equal(rm.removed, true);
  assert.deepEqual(await toolIndexForOrigin(ORIGIN), []);
});

test("set_site_tool validates name, description, and code", async () => {
  installChrome();
  const { BROWSER_TOOLS } = mod;
  assert.equal((await BROWSER_TOOLS.set_site_tool.run(CTX, [ORIGIN, "!!!", "d", [], "x"])).success, false);
  assert.equal((await BROWSER_TOOLS.set_site_tool.run(CTX, [ORIGIN, "ok", " ", [], "x"])).success, false);
  assert.equal((await BROWSER_TOOLS.set_site_tool.run(CTX, [ORIGIN, "ok", "d", [], "   "])).success, false);
});

test("call_site_tool injects args (defaults applied) and uses awaitPromise, never replMode", async () => {
  installChrome();
  const { BROWSER_TOOLS } = mod;
  await BROWSER_TOOLS.set_site_tool.run(CTX, [
    ORIGIN,
    "calc",
    "multiply",
    [{ name: "n", required: true }, { name: "mult", default: 2 }],
    "return args.n * args.mult",
  ]);

  const r = await BROWSER_TOOLS.call_site_tool.run(CTX, [ORIGIN, "calc", { n: 5 }]);
  assert.deepEqual(r, { result: { ok: true }, type: "object" }); // shape from execute path

  assert.equal(evalCalls.length, 1);
  const ev = evalCalls[0];
  // args injected as a const preamble with provided + default values
  assert.match(ev.expression, /const args = \{"n":5,"mult":2\};/);
  assert.match(ev.expression, /return args\.n \* args\.mult/);
  // CDP flags: the execute_script fix must hold here too
  assert.equal(ev.returnByValue, true);
  assert.equal(ev.awaitPromise, true);
  assert.equal(ev.replMode, undefined);
});

test("call_site_tool blocks on a missing required arg WITHOUT evaluating", async () => {
  installChrome();
  const { BROWSER_TOOLS } = mod;
  await BROWSER_TOOLS.set_site_tool.run(CTX, [ORIGIN, "search", "search", [{ name: "q", required: true }], "return args.q"]);
  const r = await BROWSER_TOOLS.call_site_tool.run(CTX, [ORIGIN, "search", {}]);
  assert.match(r.error, /Missing required argument\(s\): q/);
  assert.equal(evalCalls.length, 0, "must not reach Runtime.evaluate when validation fails");
});

test("call_site_tool errors on unknown tool name", async () => {
  installChrome();
  const { BROWSER_TOOLS } = mod;
  await BROWSER_TOOLS.set_site_tool.run(CTX, [ORIGIN, "exists", "d", [], "1"]);
  const r = await BROWSER_TOOLS.call_site_tool.run(CTX, [ORIGIN, "nope", {}]);
  assert.match(r.error, /No tool named 'nope'/);
  assert.match(r.error, /Available: exists/);
});

test("site tools sync round-trip uses separate keys and restores byte-identical", async () => {
  installChrome();
  const { BROWSER_TOOLS, mirrorToolsToSync, hydrateToolsFromSync } = mod;
  await BROWSER_TOOLS.set_site_tool.run(CTX, [ORIGIN, "big", "d", [], "x".repeat(16000)]);

  const before = (await chrome.storage.local.get("hyphaSiteTools")).hyphaSiteTools;
  await mirrorToolsToSync(before);

  // tools use their OWN sync keys, not the skills ones
  const meta = (await chrome.storage.sync.get("hyphaToolsMeta")).hyphaToolsMeta;
  assert.ok(meta.chunks >= 2);
  assert.equal(meta.partial, false);
  assert.deepEqual(await chrome.storage.sync.get("hyphaSkillsMeta"), {}); // skills untouched

  await chrome.storage.local.remove("hyphaSiteTools");
  await hydrateToolsFromSync();
  const after = (await chrome.storage.local.get("hyphaSiteTools")).hyphaSiteTools;
  assert.deepEqual(after, before);
});

test("call_site_tool surfaces the full error + stack trace on a runtime exception", async () => {
  // chrome.debugger.Runtime.evaluate returns a CDP exceptionDetails for a throw
  globalThis.chrome = {
    storage: { local: makeArea(), sync: makeArea() },
    tabs: { get: async (id) => ({ id, url: "https://shop.example/cart" }) },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_t, method) => {
        if (method !== "Runtime.evaluate") return {};
        return {
          exceptionDetails: {
            text: "Uncaught",
            lineNumber: 0,
            columnNumber: 12,
            exception: {
              className: "TypeError",
              description: "TypeError: foo is not a function\n    at <anonymous>:1:13",
            },
            stackTrace: { callFrames: [{ functionName: "", url: "", lineNumber: 0, columnNumber: 12 }] },
          },
        };
      },
    },
  };
  const { BROWSER_TOOLS } = mod;
  await BROWSER_TOOLS.set_site_tool.run(CTX, [ORIGIN, "boom", "throws", [], "foo()"]);
  const r = await BROWSER_TOOLS.call_site_tool.run(CTX, [ORIGIN, "boom", {}]);
  assert.equal(r.error, "TypeError: foo is not a function"); // one-line message
  assert.equal(r.name, "TypeError"); // exception class
  assert.match(r.stack, /at <anonymous>:1:13/); // FULL stack trace for debugging
  assert.equal(r.line, 1); // 0-based CDP line → 1-based
  assert.equal(r.column, 13);
});
