/**
 * Regression guard for the critical learning:
 *   chrome.storage is RESTRICTED in MV3 offscreen documents. A chrome.storage
 *   call inside the offscreen's connect() silently aborted the whole Hypha
 *   connection in a past regression. The offscreen must use ONLY chrome.runtime
 *   messaging; the service worker owns ALL persistence.
 *
 * We assert at the source level that src/offscreen.ts never references
 * chrome.storage. (A runtime test is impractical: offscreen.ts imports hypha-rpc,
 * which references window/document and can't load in bare Node.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, "..", "src", "offscreen.ts"), "utf8");

test("offscreen.ts does NOT touch chrome.storage (restricted in offscreen docs)", () => {
  // strip comments so an explanatory comment mentioning chrome.storage is allowed
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    code,
    /chrome\s*\.\s*storage/,
    "offscreen.ts must not call chrome.storage — the SW owns persistence",
  );
});

test("offscreen.ts drives (re)connect purely via chrome.runtime messaging", () => {
  assert.match(SRC, /chrome\.runtime\.onMessage/);
  assert.match(SRC, /__off/); // SW↔offscreen control channel
});
