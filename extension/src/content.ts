/**
 * Content script (isolated world) — the page executor. Runs page-level tools
 * against the real DOM on request from the background SW. Injected on demand
 * into the target tab. Immune to the page's script-src; never touches the
 * network (page connect-src is irrelevant). get_react_tree is delegated to the
 * MAIN-world helper (fiber expandos aren't visible in the isolated world).
 *
 * Args arrive already mapped to positional (the offscreen applied baseWrapFn),
 * so we call the raw service functions directly.
 */
import { createServiceMap } from "../../javascript/src/relay/service-map.js";

const FLAG = "__HYPHA_DEBUGGER_AGENT__";

function callMainWorldReact(selector?: string, depth?: number): Promise<any> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onResp = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.id !== id) return;
      window.removeEventListener("hypha-debugger:react-response", onResp);
      resolve(d.result);
    };
    window.addEventListener("hypha-debugger:react-response", onResp);
    window.dispatchEvent(
      new CustomEvent("hypha-debugger:react-request", { detail: { id, selector, depth } }),
    );
    setTimeout(() => {
      window.removeEventListener("hypha-debugger:react-response", onResp);
      resolve({ error: "React bridge timed out (main-world helper not present?)" });
    }, 8000);
  });
}

(function main() {
  const w = window as any;
  if (w[FLAG]) return; // idempotent — injected on demand, possibly repeatedly
  w[FLAG] = true;

  const map = new Map(createServiceMap().map((e) => [e.name, e.fn]));

  chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: any) => {
    if (!msg || !msg.__hyphaPage) return;
    (async () => {
      try {
        const args = msg.args || [];
        let value: any;
        if (msg.method === "get_react_tree") {
          value = await callMainWorldReact(args[0], args[1]);
        } else {
          const fn = map.get(msg.method);
          value = fn ? await fn(...args) : { error: `Unknown page method: ${msg.method}` };
        }
        sendResponse({ value });
      } catch (e: any) {
        sendResponse({ __error: e?.message ?? String(e) });
      }
    })();
    return true; // async response
  });
})();
