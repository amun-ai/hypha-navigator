/**
 * DOM query and manipulation service.
 */

export interface ElementInfo {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  attributes: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  children_count: number;
}

function elementToInfo(el: Element): ElementInfo {
  const rect = el.getBoundingClientRect();
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attrs[attr.name] = attr.value;
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id,
    classes: Array.from(el.classList),
    text: (el.textContent ?? "").trim().slice(0, 500),
    attributes: attrs,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    visible:
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(el).visibility !== "hidden" &&
      getComputedStyle(el).display !== "none",
    children_count: el.children.length,
  };
}

export function queryDom(
  selector: string,
  limit?: number,
): ElementInfo[] {
  limit = limit ?? 20;
  const elements = document.querySelectorAll(selector);
  const results: ElementInfo[] = [];
  for (let i = 0; i < Math.min(elements.length, limit); i++) {
    results.push(elementToInfo(elements[i]));
  }
  return results;
}

queryDom.__schema__ = {
  name: "queryDom",
  description:
    "Query DOM elements by CSS selector. Returns tag, id, classes, text content, attributes, bounding rect, and visibility for each matching element.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: 'CSS selector to query, e.g. "button.primary", "#app > div".',
      },
      limit: {
        type: "number",
        description: "Maximum number of elements to return. Default: 20.",
      },
    },
    required: ["selector"],
  },
};

export function clickElement(selector: string): { success: boolean; message: string } {
  const el = document.querySelector(selector);
  if (!el) {
    return { success: false, message: `No element found for selector: ${selector}` };
  }
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    })
  );
  return { success: true, message: `Clicked element: ${selector}` };
}

clickElement.__schema__ = {
  name: "clickElement",
  description: "Click a DOM element matching the CSS selector.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element to click.",
      },
    },
    required: ["selector"],
  },
};

export function fillInput(
  selector: string,
  value: string
): { success: boolean; message: string } {
  const el = document.querySelector(selector);
  if (!el) {
    return { success: false, message: `No element found for selector: ${selector}` };
  }

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
    // Use native setter to bypass React controlled component interception
    const proto =
      tag === "textarea"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, value);
    } else {
      inputEl.value = value;
    }
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, message: `Filled ${selector} with value` };
  }

  if (tag === "select") {
    const selectEl = el as HTMLSelectElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(selectEl, value);
    } else {
      selectEl.value = value;
    }
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, message: `Set ${selector} to ${value}` };
  }

  return { success: false, message: `Element ${selector} is not an input/textarea/select` };
}

fillInput.__schema__ = {
  name: "fillInput",
  description:
    "Set the value of an input, textarea, or select element. Works with React controlled components.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the input element.",
      },
      value: {
        type: "string",
        description: "The value to set.",
      },
    },
    required: ["selector", "value"],
  },
};

export function scrollTo(
  target: string | { x: number; y: number }
): { success: boolean; message: string } {
  if (typeof target === "string") {
    const el = document.querySelector(target);
    if (!el) {
      return { success: false, message: `No element found for selector: ${target}` };
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return { success: true, message: `Scrolled to ${target}` };
  }
  window.scrollTo({ left: target.x, top: target.y, behavior: "smooth" });
  return { success: true, message: `Scrolled to (${target.x}, ${target.y})` };
}

scrollTo.__schema__ = {
  name: "scrollTo",
  description:
    "Scroll to a DOM element (by CSS selector) or to an absolute position {x, y}.",
  parameters: {
    type: "object",
    properties: {
      target: {
        description:
          'CSS selector string to scroll to an element, or an object {x, y} for absolute scroll position.',
      },
    },
    required: ["target"],
  },
};

export function getComputedStyles(
  selector: string,
  properties?: string[]
): Record<string, string> | { error: string } {
  const el = document.querySelector(selector);
  if (!el) {
    return { error: `No element found for selector: ${selector}` };
  }
  const computed = getComputedStyle(el);
  const result: Record<string, string> = {};
  const props =
    properties ??
    [
      "display",
      "position",
      "width",
      "height",
      "color",
      "background-color",
      "font-size",
      "font-family",
      "margin",
      "padding",
      "border",
      "opacity",
      "visibility",
      "overflow",
      "z-index",
    ];
  for (const prop of props) {
    result[prop] = computed.getPropertyValue(prop);
  }
  return result;
}

getComputedStyles.__schema__ = {
  name: "getComputedStyles",
  description: "Get computed CSS styles for an element.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element.",
      },
      properties: {
        type: "array",
        items: { type: "string" },
        description:
          'CSS property names to retrieve, e.g. ["color", "font-size"]. Omit for common defaults.',
      },
    },
    required: ["selector"],
  },
};

export function getElementBounds(
  selector: string
): { bounds: ElementInfo["bounds"]; visible: boolean } | { error: string } {
  const el = document.querySelector(selector);
  if (!el) {
    return { error: `No element found for selector: ${selector}` };
  }
  const rect = el.getBoundingClientRect();
  return {
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    visible:
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(el).visibility !== "hidden" &&
      getComputedStyle(el).display !== "none",
  };
}

getElementBounds.__schema__ = {
  name: "getElementBounds",
  description: "Get the bounding rectangle and visibility of a DOM element.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element.",
      },
    },
    required: ["selector"],
  },
};

export function getHtml(
  selector?: string,
  outer?: boolean,
  max_length?: number,
): { html: string; length: number; truncated: boolean } | { error: string } {
  const useOuter = outer ?? true;
  const maxLen = max_length ?? 50000;

  const el = selector ? document.querySelector(selector) : document.documentElement;
  if (!el) {
    return { error: `No element found for selector: ${selector}` };
  }

  const raw = useOuter ? el.outerHTML : el.innerHTML;
  const truncated = raw.length > maxLen;
  return {
    html: truncated ? raw.slice(0, maxLen) : raw,
    length: raw.length,
    truncated,
  };
}

getHtml.__schema__ = {
  name: "getHtml",
  description:
    "Get the HTML content of the page or a specific element. Returns outerHTML by default. Useful for understanding page structure.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "CSS selector of the element. Omit to get the full page HTML.",
      },
      outer: {
        type: "boolean",
        description:
          "If true (default), return outerHTML (includes the element itself). If false, return innerHTML (children only).",
      },
      max_length: {
        type: "number",
        description:
          "Maximum character length of the returned HTML. Default: 50000. Result will be truncated if longer.",
      },
    },
  },
};
