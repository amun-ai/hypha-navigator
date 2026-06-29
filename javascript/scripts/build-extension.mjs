/**
 * Build the MV3 extension (../extension) with esbuild. Lives in the javascript
 * package so esbuild/deps resolve from javascript/node_modules. Bundles each
 * entry, post-processes the hypha-rpc bundle for the extension CSP, and copies
 * the static files into ../extension/dist/. Load that dir unpacked in Chrome.
 *
 *   content.js / main-world.js → IIFE (injected via chrome.scripting)
 *   background / offscreen / sidepanel → ESM (loaded as type="module")
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(SCRIPTS, "..", "..", "extension");
const NODE_MODULES = resolve(SCRIPTS, "..", "node_modules"); // javascript/node_modules
const p = (...x) => resolve(EXT, ...x);
mkdirSync(p("dist"), { recursive: true });

// Map relative ".js" specifiers to ".ts" source; fall through for real ".js".
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

const common = {
  bundle: true,
  platform: "browser",
  target: "chrome116",
  legalComments: "none",
  logLevel: "warning",
  nodePaths: [NODE_MODULES], // resolve bare imports (hypha-rpc, html-to-image) here
  plugins: [tsResolve],
};

const entries = [
  { in: "src/background.ts", out: "dist/background.js", format: "esm" },
  { in: "src/content.ts", out: "dist/content.js", format: "iife" },
  { in: "src/main-world.ts", out: "dist/main-world.js", format: "iife" },
  { in: "src/sidepanel.ts", out: "dist/sidepanel.js", format: "esm" },
  { in: "src/offscreen.ts", out: "dist/offscreen.js", format: "esm", patch: true },
];

for (const e of entries) {
  await build({ ...common, entryPoints: [p(e.in)], outfile: p(e.out), format: e.format });
  if (e.patch) patchHyphaRpc(p(e.out));
  console.log("  built", e.out);
}
for (const f of ["manifest.json", "offscreen.html", "sidepanel.html", "INSTALL.txt"]) {
  copyFileSync(p(f), p("dist", f));
}

// Keep the GH Pages download link version-stamped (cache-bust + visible version)
// so users never get a stale cached zip.
try {
  const version = JSON.parse(readFileSync(p("manifest.json"), "utf8")).version;
  const docs = resolve(EXT, "..", "docs", "index.html");
  if (existsSync(docs)) {
    let html = readFileSync(docs, "utf8");
    html = html
      .replace(
        /(href="hypha-debugger-extension\.zip\?v=)[^"]*(")/,
        `$1${version}$2`,
      )
      .replace(
        /(<span id="ext-version"[^>]*>)v[^<]*(<\/span>)/,
        `$1v${version}$2`,
      );
    writeFileSync(docs, html);
    console.log(`  stamped docs download link → v${version}`);
  }
} catch (e) {
  console.warn("  (could not stamp docs version:", e.message, ")");
}

console.log("extension built → extension/dist/ (load unpacked in chrome://extensions)");

function patchHyphaRpc(file) {
  let code = readFileSync(file, "utf8");
  code = code
    .replace(/\bthis\[(["']webpackChunk[^"']+["'])\]/g, "globalThis[$1]")
    .replace(/\bthis\.webpackChunk([A-Za-z_$][A-Za-z0-9_$]*)/g, "globalThis.webpackChunk$1")
    .replace(
      /if\s*\(\s*!([A-Za-z_$][\w$]*)\s*\)\s*throw new Error\(\s*"Automatic publicPath is not supported in this browser"\s*\)/g,
      'if(!$1)$1=""',
    )
    .replace(/\.push\(eval\(([A-Za-z_$][\w$]*)\)\)/g, ".push(globalThis[$1])");
  writeFileSync(file, code);
}
