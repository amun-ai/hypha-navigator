/**
 * React component tree inspection service.
 */

interface FiberNode {
  tag: number;
  type: any;
  memoizedState: any;
  memoizedProps: any;
  stateNode: any;
  child: FiberNode | null;
  sibling: FiberNode | null;
  return: FiberNode | null;
  key: string | null;
}

interface ReactComponentInfo {
  name: string;
  type: "function" | "class" | "host" | "other";
  props: Record<string, any>;
  state: any;
  key: string | null;
  children: ReactComponentInfo[];
}

function getFiberFromDOM(node: Element): FiberNode | null {
  const keys = Object.keys(node);
  const fiberKey = keys.find(
    (k) =>
      k.startsWith("__reactFiber$") ||
      k.startsWith("__reactInternalInstance$")
  );
  return fiberKey ? (node as any)[fiberKey] : null;
}

/**
 * Find the topmost DOM element that has a React fiber attached.
 * React mounts on various nodes — #root is common but not universal
 * (#app, #__next, body, etc.). We scan until we find one.
 */
function findReactRoot(): Element | null {
  // Try common selectors first (fast path)
  const common = ["#root", "#app", "#__next", "[data-reactroot]", "main", "body"];
  for (const sel of common) {
    const el = document.querySelector(sel);
    if (el && getFiberFromDOM(el)) return el;
  }
  // Slow path: walk the tree, find first element with a fiber
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    null,
  );
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof Element && getFiberFromDOM(node)) return node;
    node = walker.nextNode();
  }
  return null;
}

function getComponentName(fiber: FiberNode): string {
  const { type } = fiber;
  if (!type) return "(unknown)";
  if (typeof type === "string") return type; // DOM element
  if (typeof type === "function") {
    return type.displayName || type.name || "Anonymous";
  }
  if (typeof type === "object") {
    if (type.displayName) return type.displayName;
    if (type.render)
      return type.render.displayName || type.render.name || "ForwardRef";
    if (type.type) return getComponentName({ type: type.type } as FiberNode);
    // React.memo
    if (type.$$typeof?.toString() === "Symbol(react.memo)") {
      return `Memo(${getComponentName({ type: type.type } as FiberNode)})`;
    }
  }
  return "(unknown)";
}

function getFiberType(fiber: FiberNode): ReactComponentInfo["type"] {
  // Fiber tag values: 0=FunctionComponent, 1=ClassComponent, 5=HostComponent
  if (fiber.tag === 0 || fiber.tag === 11 || fiber.tag === 14 || fiber.tag === 15)
    return "function";
  if (fiber.tag === 1) return "class";
  if (fiber.tag === 5 || fiber.tag === 6) return "host";
  return "other";
}

function safeSerialize(obj: any, depth = 0, maxDepth = 2): any {
  if (depth > maxDepth) return "[max depth]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "function") return `[Function: ${obj.name || "anonymous"}]`;
  if (typeof obj !== "object") return obj;
  if (obj instanceof HTMLElement) return `[${obj.tagName.toLowerCase()}#${obj.id}]`;
  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map((v) => safeSerialize(v, depth + 1, maxDepth));
  }
  const result: Record<string, any> = {};
  const keys = Object.keys(obj).slice(0, 20);
  for (const key of keys) {
    if (key.startsWith("_") || key.startsWith("$$")) continue;
    try {
      result[key] = safeSerialize(obj[key], depth + 1, maxDepth);
    } catch {
      result[key] = "[unserializable]";
    }
  }
  return result;
}

function extractState(fiber: FiberNode): any {
  if (fiber.tag === 1 && fiber.stateNode) {
    // Class component
    return safeSerialize(fiber.stateNode.state);
  }
  if (fiber.tag === 0 || fiber.tag === 11 || fiber.tag === 15) {
    // Function component - hooks linked list
    const states: any[] = [];
    let hook = fiber.memoizedState;
    let i = 0;
    while (hook && i < 20) {
      if (hook.queue !== null && hook.queue !== undefined) {
        states.push(safeSerialize(hook.memoizedState));
      }
      hook = hook.next;
      i++;
    }
    return states.length > 0 ? states : null;
  }
  return null;
}

function fiberToInfo(
  fiber: FiberNode,
  depth: number,
  maxDepth: number
): ReactComponentInfo | null {
  const fiberType = getFiberType(fiber);

  // Skip host elements unless at the top level
  const isComponent = fiberType === "function" || fiberType === "class";

  const info: ReactComponentInfo = {
    name: getComponentName(fiber),
    type: fiberType,
    props: isComponent ? safeSerialize(fiber.memoizedProps) : {},
    state: isComponent ? extractState(fiber) : null,
    key: fiber.key,
    children: [],
  };

  if (depth < maxDepth) {
    let child = fiber.child;
    while (child) {
      const childInfo = fiberToInfo(child, depth + 1, maxDepth);
      if (childInfo) {
        // For host elements, only include if they have component children
        if (childInfo.type !== "host" || childInfo.children.length > 0) {
          info.children.push(childInfo);
        }
      }
      child = child.sibling;
    }
  }

  return info;
}

export function getReactTree(
  selector?: string,
  max_depth?: number,
): ReactComponentInfo | { error: string } {
  const maxDepth = max_depth ?? 5;

  let rootEl: Element | null;
  let usedSelector: string;
  if (selector) {
    rootEl = document.querySelector(selector);
    usedSelector = selector;
    if (!rootEl) {
      return { error: `No element found for selector: ${selector}` };
    }
  } else {
    // Auto-detect: scan for any element with a React fiber attached
    rootEl = findReactRoot();
    usedSelector = rootEl?.tagName.toLowerCase() + (rootEl?.id ? "#" + rootEl.id : "") || "(auto)";
    if (!rootEl) {
      return {
        error:
          "No React root found on this page. Tried #root, #app, #__next, [data-reactroot], main, body — none had React fibers. This page may not be a React app, or React may not have rendered yet. Pass an explicit `selector` if you know the mount point.",
      };
    }
  }

  const fiber = getFiberFromDOM(rootEl);
  if (!fiber) {
    return {
      error: `No React fiber found on element "${usedSelector}". Is this a React app?`,
    };
  }

  // Walk up to find the root component fiber (skip HostRoot)
  let current: FiberNode | null = fiber;
  while (current && current.tag === 3) {
    // tag 3 = HostRoot
    current = current.child;
  }
  if (!current) {
    return { error: "Could not find root React component fiber." };
  }

  const tree = fiberToInfo(current, 0, maxDepth);
  if (!tree) {
    return { error: "Could not build React component tree." };
  }
  return tree;
}

getReactTree.__schema__ = {
  name: "getReactTree",
  description:
    "Inspect the React component tree. Returns component names, props, state (including hooks), and children hierarchy. " +
    "When no selector is provided, auto-detects the React root by scanning common mount points (#root, #app, #__next, [data-reactroot], main, body) and then walking the DOM for any element with a React fiber attached.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "CSS selector of the React root element. Omit for auto-detection.",
      },
      max_depth: {
        type: "number",
        description: "Maximum depth to traverse the component tree. Default: 5.",
      },
    },
  },
};
