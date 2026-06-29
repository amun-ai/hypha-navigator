/**
 * Hypha RPC service wrappers for the PageController.
 *
 * These functions are schema-annotated for AI agent / LLM tool calling.
 * They provide smart DOM analysis with indexed interactive elements,
 * enabling agents to interact with pages by element index instead of
 * fragile CSS selectors.
 */
import { PageController } from "../page-controller/index.js";

// Singleton — shared across all service calls
let controller: PageController | null = null;

function getController(): PageController {
  if (!controller) {
    controller = new PageController({
      viewportExpansion: -1, // full page by default
      highlightOpacity: 0.1, // 10% fill on element boxes
      highlightLabelOpacity: 0.5, // 50% opacity on number labels + borders
    });
  }
  return controller;
}

/**
 * Get the current browser state: page info, scroll position, and a
 * simplified HTML representation with all interactive elements indexed
 * as [0], [1], [2], etc. Use the indices to call click_element_by_index,
 * input_text, select_option, or scroll.
 */
export async function getBrowserState(
  viewport_only?: boolean
): Promise<{
  url: string;
  title: string;
  header: string;
  content: string;
  footer: string;
  element_count: number;
}> {
  const ctrl = getController();
  if (viewport_only !== undefined) {
    (ctrl as any).config.viewportExpansion = viewport_only ? 0 : -1;
  }
  // Hard timeout: pages with heavy DOMs or cross-origin iframes can
  // make the tree walk take much longer than expected. Don't leave
  // the HTTP caller waiting forever.
  const timeoutMs = 15000;
  return Promise.race([
    ctrl.getBrowserState(),
    new Promise<any>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `get_browser_state timed out after ${timeoutMs}ms (complex DOM or cross-origin iframes)`,
            ),
          ),
        timeoutMs,
      ),
    ),
  ]);
}

getBrowserState.__schema__ = {
  name: "getBrowserState",
  description:
    "Get the current page state with all interactive elements indexed as [0], [1], [2], etc. " +
    "Returns a simplified HTML representation optimized for LLM consumption. " +
    "Interactive elements (buttons, links, inputs, scrollable areas) are detected via smart heuristics " +
    "(CSS cursor, ARIA roles, event listeners, tag names). " +
    "Use the returned indices with click_element_by_index, input_text, select_option, or scroll. " +
    "Call this first to understand the page before performing any actions.",
  parameters: {
    type: "object",
    properties: {
      viewport_only: {
        type: "boolean",
        description:
          "If true, only return elements visible in the current viewport. Default: false (full page).",
      },
    },
  },
};

/**
 * Click an interactive element by its index from get_browser_state.
 */
export async function clickElementByIndex(
  index: number
): Promise<{ success: boolean; message: string }> {
  return getController().clickElement(index);
}

clickElementByIndex.__schema__ = {
  name: "clickElementByIndex",
  description:
    "Click an interactive element by its numeric index from get_browser_state output. " +
    "Simulates a full mouse event sequence (hover, mousedown, focus, mouseup, click) " +
    "to trigger all event listeners including React/Vue handlers.",
  parameters: {
    type: "object",
    properties: {
      index: {
        type: "number",
        description:
          "The element index from get_browser_state (e.g. 0 for [0], 5 for [5]).",
      },
    },
    required: ["index"],
  },
};

/**
 * Type text into an input, textarea, or contenteditable element by index.
 */
export async function inputText(
  index: number,
  text: string
): Promise<{ success: boolean; message: string }> {
  return getController().inputText(index, text);
}

inputText.__schema__ = {
  name: "inputText",
  description:
    "Type text into an input, textarea, or contenteditable element by its index. " +
    "Replaces existing content. Works with React controlled components, " +
    "contenteditable editors (LinkedIn, Quill), and native inputs.",
  parameters: {
    type: "object",
    properties: {
      index: {
        type: "number",
        description: "The element index from get_browser_state.",
      },
      text: {
        type: "string",
        description: "The text to type into the element.",
      },
    },
    required: ["index", "text"],
  },
};

/**
 * Select a dropdown option by element index and option text.
 */
export async function selectOption(
  index: number,
  option_text: string
): Promise<{ success: boolean; message: string }> {
  return getController().selectOption(index, option_text);
}

selectOption.__schema__ = {
  name: "selectOption",
  description:
    "Select a dropdown option in a <select> element by its index and the visible option text.",
  parameters: {
    type: "object",
    properties: {
      index: {
        type: "number",
        description: "The <select> element index from get_browser_state.",
      },
      option_text: {
        type: "string",
        description:
          "The visible text of the option to select (case-sensitive, trimmed).",
      },
    },
    required: ["index", "option_text"],
  },
};

/**
 * Scroll the page or a specific scrollable container.
 */
export async function scroll(
  direction: "up" | "down" | "left" | "right",
  amount?: number,
  index?: number
): Promise<{ success: boolean; message: string }> {
  return getController().scroll({ direction, amount, index });
}

scroll.__schema__ = {
  name: "scroll",
  description:
    "Scroll the page or a specific scrollable container. " +
    "If index is provided, scrolls the nearest scrollable ancestor of that element. " +
    "Otherwise scrolls the page or the largest scrollable container.",
  parameters: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Scroll direction.",
      },
      amount: {
        type: "number",
        description:
          "Scroll amount in pixels. Default: ~80% of viewport height (vertical) or width (horizontal).",
      },
      index: {
        type: "number",
        description:
          "Optional element index. If provided, scrolls the nearest scrollable ancestor of this element.",
      },
    },
    required: ["direction"],
  },
};

/**
 * Remove all visual element highlights/labels from the page.
 */
export async function removeHighlights(): Promise<{
  success: boolean;
  message: string;
}> {
  getController().cleanUpHighlights();
  return { success: true, message: "Highlights removed." };
}

removeHighlights.__schema__ = {
  name: "removeHighlights",
  description:
    "Remove all visual element index labels/highlights from the page. " +
    "Useful after taking a screenshot if you want a clean view.",
  parameters: {
    type: "object",
    properties: {},
  },
};

/**
 * Dispose the page controller (for cleanup).
 */
export function disposeController(): void {
  if (controller) {
    controller.dispose();
    controller = null;
  }
}
