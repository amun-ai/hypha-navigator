/**
 * Mock-chrome logic tests for the skill store + chrome.storage.sync round-trip,
 * which live in src/browser-tools.ts. That module pulls in shared sources via
 * ".js" specifiers, so we bundle it with esbuild (reusing the build's .js→.ts
 * resolver), inject an in-memory `chrome` global, and exercise it in Node.
 *
 * Covers the HANDOVER's critical learnings:
 *  - skill model: per-origin set/get/remove/list, name normalization
 *  - sync round-trip: chunked mirror → hydrate restores byte-identical
 *  - over-quota → catalog-only (names+descriptions) fallback
 *  - kwargs→positional: each tool's run() destructuring matches its schema order
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// ---- in-memory chrome.storage mock --------------------------------------
function makeArea(quotaBytes) {
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
      if (quotaBytes != null) {
        const tmp = new Map(store);
        for (const [k, v] of Object.entries(obj)) tmp.set(k, v);
        let bytes = 0;
        for (const [k, v] of tmp) bytes += k.length + JSON.stringify(v).length;
        if (bytes > quotaBytes) throw new Error("QUOTA_BYTES_PER_ITEM/total quota exceeded");
      }
      for (const [k, v] of Object.entries(obj)) store.set(k, clone(v));
    },
    async remove(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) store.delete(k);
    },
  };
}

function installChrome({ syncQuota } = {}) {
  globalThis.chrome = {
    storage: { local: makeArea(), sync: makeArea(syncQuota) },
  };
  return globalThis.chrome;
}

// ---- bundle browser-tools.ts (same .js→.ts resolver as the build) --------
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
  const out = resolve(HERE, ".tmp-browser-tools.mjs");
  await build({
    entryPoints: [resolve(ROOT, "src/browser-tools.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: false, // keep run() source readable for the schema-order check
    nodePaths: [resolve(ROOT, "node_modules")],
    plugins: [tsResolve],
    logLevel: "warning",
  });
  mod = await import(pathToFileURL(out).href);
});

const CTX = { setTarget() {}, getTarget: () => null };

test("set_site_skill stores per-origin; list/get/index reflect it; name is normalized", async () => {
  installChrome();
  const { BROWSER_TOOLS, skillIndexForOrigin } = mod;
  const origin = "https://example.com";

  const r = await BROWSER_TOOLS.set_site_skill.run(CTX, [
    origin,
    "Export Report!", // not slug-safe → normalized
    "How to export the weekly report",
    "## Steps\n1. open\n2. click export",
  ]);
  assert.equal(r.success, true);
  assert.equal(r.origin, origin);
  assert.equal(r.name, "export-report"); // normalized to agentskills naming
  assert.equal(r.count, 1);

  const idx = await skillIndexForOrigin(origin);
  assert.deepEqual(idx, [{ name: "export-report", description: "How to export the weekly report" }]);

  const got = await BROWSER_TOOLS.get_site_skill.run(CTX, [origin, "export-report"]);
  assert.equal(got.found, true);
  assert.match(got.content, /click export/);
  assert.match(got.skill_md, /^---\nname: export-report\ndescription: How to export the weekly report\n---/);

  // unrelated origin is isolated
  assert.deepEqual(await skillIndexForOrigin("https://other.com"), []);

  const rm = await BROWSER_TOOLS.remove_site_skill.run(CTX, [origin, "export-report"]);
  assert.equal(rm.removed, true);
  assert.deepEqual(await skillIndexForOrigin(origin), []);
});

test("set_site_skill rejects an unusable name / empty description", async () => {
  installChrome();
  const { BROWSER_TOOLS } = mod;
  const bad = await BROWSER_TOOLS.set_site_skill.run(CTX, ["https://x.com", "!!!", "d", "c"]);
  assert.equal(bad.success, false);
  const noDesc = await BROWSER_TOOLS.set_site_skill.run(CTX, ["https://x.com", "ok", "  ", "c"]);
  assert.equal(noDesc.success, false);
});

test("sync round-trip: chunked mirror → hydrate restores byte-identical (incl. >1 chunk)", async () => {
  installChrome();
  const { BROWSER_TOOLS, mirrorSkillsToSync, hydrateSkillsFromSync } = mod;
  const origin = "https://big.example";
  const bigBody = "x".repeat(20000); // > SYNC_CHUNK (7000) → spans multiple chunks
  await BROWSER_TOOLS.set_site_skill.run(CTX, [origin, "huge", "a big skill", bigBody]);

  const before = await chrome.storage.local.get("hyphaSiteSkills");
  await mirrorSkillsToSync(before.hyphaSiteSkills);

  // sync should hold a multi-chunk, full-fidelity (partial:false) backup
  const meta = (await chrome.storage.sync.get("hyphaSkillsMeta")).hyphaSkillsMeta;
  assert.ok(meta.chunks >= 3, `expected >=3 chunks, got ${meta.chunks}`);
  assert.equal(meta.partial, false);

  // wipe local, hydrate from sync, expect identical store back
  await chrome.storage.local.remove("hyphaSiteSkills");
  assert.deepEqual(await chrome.storage.local.get("hyphaSiteSkills"), {});
  await hydrateSkillsFromSync();
  const after = await chrome.storage.local.get("hyphaSiteSkills");
  assert.deepEqual(after.hyphaSiteSkills, before.hyphaSiteSkills);
  assert.equal(after.hyphaSiteSkills[origin].huge.content.length, 20000);
});

test("hydrate does NOT clobber existing local skills", async () => {
  installChrome();
  const { BROWSER_TOOLS, mirrorSkillsToSync, hydrateSkillsFromSync } = mod;
  await BROWSER_TOOLS.set_site_skill.run(CTX, ["https://a.com", "one", "d", "c1"]);
  await mirrorSkillsToSync((await chrome.storage.local.get("hyphaSiteSkills")).hyphaSiteSkills);
  // change local, then hydrate — hydrate is a no-op because local is non-empty
  await BROWSER_TOOLS.set_site_skill.run(CTX, ["https://a.com", "two", "d", "c2"]);
  await hydrateSkillsFromSync();
  const idx = await mod.skillIndexForOrigin("https://a.com");
  assert.deepEqual(idx.map((s) => s.name).sort(), ["one", "two"]);
});

test("over-quota mirror falls back to catalog-only (names+descriptions, partial:true)", async () => {
  installChrome({ syncQuota: 2000 }); // tiny sync quota forces the fallback
  const { BROWSER_TOOLS, mirrorSkillsToSync } = mod;
  const origin = "https://quota.example";
  await BROWSER_TOOLS.set_site_skill.run(CTX, [origin, "fat", "a description that survives", "B".repeat(50000)]);

  await mirrorSkillsToSync((await chrome.storage.local.get("hyphaSiteSkills")).hyphaSiteSkills);

  const meta = (await chrome.storage.sync.get("hyphaSkillsMeta")).hyphaSkillsMeta;
  assert.equal(meta.partial, true, "should mark the backup as partial (catalog-only)");

  // reassemble the synced JSON → bodies dropped, descriptions kept
  const keys = Array.from({ length: meta.chunks }, (_, i) => "hyphaSkillsChunk" + i);
  const got = await chrome.storage.sync.get(keys);
  let json = "";
  for (let i = 0; i < meta.chunks; i++) json += got["hyphaSkillsChunk" + i] || "";
  const restored = JSON.parse(json);
  assert.equal(restored[origin].fat.content, "");
  assert.equal(restored[origin].fat.description, "a description that survives");
});

test("INVARIANT: every tool's run() array-destructuring matches its schema property order", () => {
  const { BROWSER_TOOLS } = mod;
  for (const [toolName, tool] of Object.entries(BROWSER_TOOLS)) {
    const props = Object.keys(tool.schema?.parameters?.properties || {});
    const src = tool.run.toString();
    // grab the parameter list of the run function: (ctx, [a, b = 1]) => ...
    const m = src.match(/^\s*(?:async\s*)?\(([^)]*)\)/);
    assert.ok(m, `${toolName}: could not parse run() params from: ${src.slice(0, 80)}`);
    const params = m[1];
    const bracket = params.match(/\[([^\]]*)\]/);
    const destructured = bracket
      ? bracket[1]
          .split(",")
          .map((s) => s.trim().split(/[=:]/)[0].trim())
          .filter(Boolean)
      : [];
    if (props.length === 0) {
      // no params: run may take ctx only (or nothing) — nothing to check
      continue;
    }
    // The destructured names must be a prefix-aligned, same-order match of the
    // schema property keys (a tool may omit trailing params it doesn't use).
    assert.deepEqual(
      destructured,
      props.slice(0, destructured.length),
      `${toolName}: run() destructuring [${destructured}] != schema order [${props}]`,
    );
    assert.ok(
      destructured.length === props.length || destructured.length > 0,
      `${toolName}: run() ignores all ${props.length} schema params`,
    );
  }
});
