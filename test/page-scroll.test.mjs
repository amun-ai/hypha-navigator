/**
 * Regression guard for page-level scroll (src/shared/page-controller/index.ts).
 *
 * scroll({direction}) with no index must scroll the WHOLE PAGE. A missing index
 * arrives as `null` (not `undefined`) across the RPC/JSON boundary, so a strict
 * `index !== undefined` check wrongly calls getElementByIndex(null) and throws
 * "No interactive element found at index null". The guard must be loose:
 * `index != null` (covers both null and undefined → scroll the page).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(HERE, "..", "src", "shared", "page-controller", "index.ts"),
  "utf8",
);

test("scroll() selects the element with a loose null check, not strict !== undefined", () => {
  // strip comments (an explanatory comment may mention the old form)
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // the page-scroll element selection must use `index != null ? getElementByIndex`
  assert.match(
    code,
    /index\s*!=\s*null\s*\?\s*getElementByIndex/,
    "scroll() must use `index != null ? getElementByIndex(...)` so a null index scrolls the page",
  );
  assert.doesNotMatch(
    code,
    /index\s*!==\s*undefined\s*\?\s*getElementByIndex/,
    "strict `index !== undefined` breaks page scroll: a missing index arrives as null",
  );
});
