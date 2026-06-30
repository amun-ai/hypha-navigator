/**
 * Wiring guards for the "Show element overlay" toggle. The overlay is drawn in a
 * real DOM (PageController + dom-tree.js), which can't run under Node, so we
 * assert the end-to-end plumbing at the source level:
 *   side panel (persist hyphaShowHighlights) → SW (cache + pass per page-call +
 *   clear on toggle-off) → content script (apply) → getBrowserState (respect it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

test("getBrowserState draws the overlay only when highlightEnabled (off by default)", () => {
  const src = read("src/shared/services/page-controller.ts");
  assert.match(src, /let highlightEnabled = false/, "overlay must default OFF");
  assert.match(src, /export function setHighlightEnabled/);
  assert.match(
    src,
    /config\.doHighlightElements = highlightEnabled/,
    "getBrowserState must gate the overlay on the toggle",
  );
});

test("content script applies the SW's showHighlights flag before dispatching", () => {
  const src = read("src/content.ts");
  assert.match(src, /import \{ setHighlightEnabled \}/);
  assert.match(src, /setHighlightEnabled\(msg\.showHighlights\)/);
});

test("SW caches the setting, passes it per page-call, and clears the overlay when off", () => {
  const src = read("src/background.ts");
  assert.match(src, /let showHighlights = false/);
  assert.match(src, /hydrateShowHighlights/);
  assert.match(src, /__hyphaPage: true, method, args, showHighlights/, "must pass the flag to the content script");
  // toggling off clears any overlay already on the page
  assert.match(src, /if \(!showHighlights\) void clearHighlightsOnTarget\(\)/);
  assert.match(src, /method: "remove_highlights"/);
});

test("side panel persists + restores the hyphaShowHighlights setting", () => {
  const ts = read("src/sidepanel.ts");
  assert.match(ts, /hyphaShowHighlights: highlightToggle\.checked/, "save on change");
  assert.match(ts, /highlightToggle\.checked = !!r\.hyphaShowHighlights/, "restore on load");
  const html = read("sidepanel.html");
  assert.match(html, /id="showHighlights"/);
});
