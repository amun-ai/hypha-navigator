/**
 * MAIN-world helper. React fiber expandos (__reactFiber$*) are only visible in
 * the page's own JS world, not the isolated content-script world. This tiny
 * script runs in MAIN world and answers get_react_tree requests from the
 * content-script Agent over CustomEvents (plain-JSON detail crosses worlds).
 */
import { getReactTree } from "../../javascript/src/services/react.js";

(function main() {
  const FLAG = "__HYPHA_DEBUGGER_MAIN__";
  const w = window as any;
  if (w[FLAG]) return;
  w[FLAG] = true;

  window.addEventListener("hypha-debugger:react-request", async (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (!detail) return;
    let result: any;
    try {
      result = await getReactTree(detail.selector, detail.depth);
    } catch (err: any) {
      result = { error: err?.message ?? String(err) };
    }
    window.dispatchEvent(
      new CustomEvent("hypha-debugger:react-response", {
        detail: { id: detail.id, result },
      }),
    );
  });
})();
