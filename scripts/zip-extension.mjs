/**
 * Package the built extension (./dist) into a versioned .zip for the GitHub
 * Pages download. Writes BOTH:
 *   - docs/hypha-navigator-extension.zip   (served by Pages; the docs link points here)
 *   - hypha-navigator-extension-v<version>.zip  (repo root; handy as a CI release asset)
 *
 * Run `npm run build` first (this script zips whatever is in ./dist). Uses the
 * system `zip` (present on macOS and ubuntu CI runners).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS, "..");
const DIST = resolve(ROOT, "dist");

if (!existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const version = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8")).version;
mkdirSync(resolve(ROOT, "docs"), { recursive: true });

const targets = [
  resolve(ROOT, "docs", "hypha-navigator-extension.zip"),
  resolve(ROOT, `hypha-navigator-extension-v${version}.zip`),
];

for (const out of targets) {
  rmSync(out, { force: true });
  // -r recurse, -X strip extra file attrs for reproducibility; zip from inside
  // dist/ so the archive has no leading "dist/" path component.
  execFileSync("zip", ["-r", "-X", out, "."], { cwd: DIST, stdio: "inherit" });
  console.log("  packaged →", out.replace(ROOT + "/", ""));
}
console.log(`extension zipped (v${version})`);
