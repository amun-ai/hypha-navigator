/**
 * The combined tool catalog the extension registers as ONE Hypha service:
 *  - page tools (from the shared service map) operate on the current TARGET tab
 *  - browser tools (tabs/windows/navigation) drive the whole browser
 *
 * `navigate` and `get_skill_md` from the page map are dropped: navigate is
 * superseded by the browser-level navigate, and get_skill_md is generated in the
 * offscreen from this full catalog (so it documents the browser tools too).
 */
import { createServiceMap } from "../../javascript/src/relay/service-map.js";
import { BROWSER_TOOLS } from "./browser-tools.js";

// execute_script is provided as a BROWSER tool (CDP, bypasses page CSP) instead
// of the page-level one (which can't eval under strict CSP). navigate is
// superseded by the browser-level navigate; get_skill_md is generated in the
// offscreen from the full catalog.
const PAGE_EXCLUDE = new Set(["navigate", "get_skill_md", "execute_script"]);

export interface CatalogEntry {
  name: string;
  schema: any;
  kind: "page" | "browser";
}

export function buildCatalog(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const e of createServiceMap()) {
    if (PAGE_EXCLUDE.has(e.name)) continue;
    out.push({ name: e.name, schema: e.schema, kind: "page" });
  }
  for (const [name, t] of Object.entries(BROWSER_TOOLS)) {
    out.push({ name, schema: t.schema, kind: "browser" });
  }
  return out;
}
