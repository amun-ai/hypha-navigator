/**
 * Guards for two background-tab bugs (an agent usually drives a NON-foreground
 * tab, where rAF/animation/paint are throttled):
 *
 *  - scroll_to (src/shared/services/dom.ts) must use behavior:"auto" — "smooth"
 *    is rAF-driven and is a silent no-op on a background tab.
 *  - take_screenshot must be the CDP browser tool (Page.captureScreenshot, which
 *    renders off-screen regardless of focus), registered in BROWSER_TOOLS and
 *    excluded from the page-level catalog via PAGE_EXCLUDE. The page-level
 *    html-to-image route stalls/times out on a background tab.
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

// ---- source guards (cheap, no bundle) -----------------------------------
test("scroll_to uses instant 'auto' behavior, never rAF-driven 'smooth'", () => {
  const src = read("src/shared/services/dom.ts");
  const fn = src.slice(src.indexOf("export function scrollTo"));
  const body = fn.slice(0, fn.indexOf("scrollTo.__schema__"));
  assert.doesNotMatch(body, /behavior:\s*["']smooth["']/, "scroll_to must not use smooth (no-op on background tabs)");
  assert.match(body, /behavior:\s*["']auto["']/);
});

test("take_screenshot is a CDP browser tool and is excluded from the page catalog", () => {
  const bt = read("src/browser-tools.ts");
  assert.match(bt, /take_screenshot:\s*\{/, "take_screenshot must be registered in BROWSER_TOOLS");
  assert.match(bt, /Page\.captureScreenshot/, "must use CDP Page.captureScreenshot");
  const cat = read("src/service-catalog.ts");
  const exclude = cat.slice(cat.indexOf("PAGE_EXCLUDE"));
  assert.match(exclude, /"take_screenshot"/, "take_screenshot must be in PAGE_EXCLUDE");
});

// ---- runtime: CDP screenshot path ---------------------------------------
let mod;
let lastCapture;
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
  const out = resolve(HERE, ".tmp-screenshot.mjs");
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

function installChrome() {
  lastCapture = null;
  globalThis.chrome = {
    tabs: { get: async (id) => ({ id, url: "https://x.example/" }) },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_t, method, params) => {
        if (method === "Page.getLayoutMetrics") {
          return {
            cssContentSize: { width: 1280, height: 3000 },
            cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 },
          };
        }
        if (method === "Runtime.evaluate") {
          // selector path → return a bounding rect, or null for the "missing" case
          const sel = /querySelector\("([^"]*)"\)/.exec(params.expression)?.[1];
          return { result: { value: sel === "#missing" ? null : { x: 10, y: 20, width: 200, height: 100 } } };
        }
        if (method === "Page.captureScreenshot") {
          lastCapture = params;
          return { data: "QUJD" }; // base64("ABC")
        }
        return {};
      },
    },
  };
}

const CTX = { setTarget() {}, getTarget: () => 7 };

test("take_screenshot (viewport) returns a downscaled CDP capture", async () => {
  installChrome();
  const r = await mod.BROWSER_TOOLS.take_screenshot.run(CTX, [undefined, "jpeg", 0.6, 800, 800, false]);
  assert.equal(r.base64, "QUJD");
  assert.equal(r.media_type, "image/jpeg");
  assert.equal(r.data_url, "data:image/jpeg;base64,QUJD");
  // viewport 1280x800 scaled to fit 800 → scale 0.625 → 800x500
  assert.equal(r.width, 800);
  assert.equal(r.height, 500);
  // CDP must render off-screen regardless of focus
  assert.equal(lastCapture.captureBeyondViewport, true);
  assert.ok(lastCapture.clip.scale > 0 && lastCapture.clip.scale <= 1);
  assert.equal(lastCapture.quality, 60); // jpeg quality 0.6 → 60
});

test("take_screenshot (selector) clips to the element; missing selector errors", async () => {
  installChrome();
  const ok = await mod.BROWSER_TOOLS.take_screenshot.run(CTX, ["#hero", "png", undefined, 800, 800, false]);
  assert.equal(ok.media_type, "image/png");
  assert.equal(lastCapture.quality, undefined); // png → no quality
  // 200x100 fits within 800 → scale 1 → unchanged
  assert.equal(ok.width, 200);
  assert.equal(ok.height, 100);

  const miss = await mod.BROWSER_TOOLS.take_screenshot.run(CTX, ["#missing", "jpeg", 0.6, 800, 800, false]);
  assert.match(miss.error, /No element found for selector: #missing/);
});
