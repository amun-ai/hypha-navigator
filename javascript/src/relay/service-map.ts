/**
 * The single source of truth for the debug service's functions and schemas,
 * independent of how they are served (direct Hypha registration, popup relay,
 * or extension). Both the direct path (debugger.ts) and the relay agent build
 * the same set of functions from here.
 *
 * Every function returns plain JSON (screenshot returns base64 strings), so the
 * results cross postMessage / chrome.runtime via structured clone unchanged.
 */
import { getPageInfo } from "../services/info.js";
import {
  queryDom,
  clickElement,
  fillInput,
  scrollTo,
  getHtml,
} from "../services/dom.js";
import { takeScreenshot } from "../services/screenshot.js";
import { executeScript } from "../services/execute.js";
import { navigate } from "../services/navigate.js";
import { getReactTree } from "../services/react.js";
import { generateSkillMd } from "../services/skill.js";
import {
  getBrowserState,
  clickElementByIndex,
  inputText,
  selectOption,
  scroll,
  removeHighlights,
} from "../services/page-controller.js";

export interface ServiceEntry {
  name: string;
  fn: (...args: any[]) => any;
  schema: any;
}

export interface ServiceMapContext {
  /** Resolve the live service URL (used by get_skill_md). */
  getServiceUrl?: () => string;
}

export const SERVICE_META = {
  type: "debugger",
  name: "Web Debugger",
  description:
    "Remote web page debugger. Allows inspecting DOM, taking screenshots, executing JavaScript, and interacting with the page.",
};

/**
 * Build the ordered list of service entries. `get_skill_md` is generated here
 * so its docs reflect the live service URL via `ctx.getServiceUrl()`.
 */
export function createServiceMap(ctx: ServiceMapContext = {}): ServiceEntry[] {
  const base: Record<string, (...a: any[]) => any> = {
    get_page_info: getPageInfo,
    get_html: getHtml,
    query_dom: queryDom,
    click_element: clickElement,
    fill_input: fillInput,
    scroll_to: scrollTo,
    take_screenshot: takeScreenshot,
    execute_script: executeScript,
    navigate: navigate,
    get_react_tree: getReactTree,
    // Smart DOM analysis + index-based interaction (from page-controller)
    get_browser_state: getBrowserState,
    click_element_by_index: clickElementByIndex,
    input_text: inputText,
    select_option: selectOption,
    scroll: scroll,
    remove_highlights: removeHighlights,
  };

  const getSkillMd = () => {
    const schemaFns: Record<string, any> = {};
    for (const [name, f] of Object.entries(base)) {
      if ((f as any).__schema__) schemaFns[name] = f;
    }
    const url = ctx.getServiceUrl?.() ?? "{SERVICE_URL}";
    const pageContext =
      typeof document !== "undefined"
        ? { title: document.title, url: location?.href }
        : undefined;
    return generateSkillMd(schemaFns, url, pageContext);
  };
  (getSkillMd as any).__schema__ = {
    name: "getSkillMd",
    description:
      "Get the SKILL.md document describing all available debugger functions, their parameters, and usage examples. Follows the agentskills.io specification.",
    parameters: { type: "object", properties: {} },
  };

  const entries: ServiceEntry[] = Object.entries(base).map(([name, fn]) => ({
    name,
    fn,
    schema: (fn as any).__schema__,
  }));
  entries.push({
    name: "get_skill_md",
    fn: getSkillMd,
    schema: (getSkillMd as any).__schema__,
  });
  return entries;
}
