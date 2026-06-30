/**
 * Regression guard for the execute_script CDP evaluation (src/browser-tools.ts
 * cdpEval). The code is wrapped in an async IIFE, so the Runtime.evaluate call
 * MUST use awaitPromise (to resolve it) and MUST NOT use replMode — REPL mode
 * returns the UNAWAITED completion value, so the Promise serializes by-value to
 * {} and every execute_script result comes back as {"result":{},"type":"object"}.
 *
 * A runtime test would need a full CDP/JS-eval mock; a source-level invariant is
 * proportionate and pins the exact regression that shipped in 0.1.1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(HERE, "..", "src", "browser-tools.ts"), "utf8");

// Isolate the Runtime.evaluate options object passed by cdpEval.
const m = SRC.match(/Runtime\.evaluate"\s*,\s*\{([\s\S]*?)\}\s*\)/);

test("cdpEval issues a Runtime.evaluate call", () => {
  assert.ok(m, "could not find the Runtime.evaluate call in browser-tools.ts");
});

test("cdpEval awaits the async IIFE (returnByValue + awaitPromise, NOT replMode)", () => {
  const opts = m[1];
  // strip comments so an explanatory comment mentioning replMode is allowed
  const code = opts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.match(code, /returnByValue:\s*true/, "must request returnByValue");
  assert.match(code, /awaitPromise:\s*true/, "must await the IIFE's promise");
  assert.doesNotMatch(
    code,
    /replMode:\s*true/,
    "replMode:true makes CDP return the UNAWAITED promise → execute_script returns {}",
  );
});
