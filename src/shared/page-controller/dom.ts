/**
 * DOM tree utilities: build flat tree, convert to string, manage highlights.
 * Adapted from @page-agent/page-controller (MIT License).
 */
import domTree from "./dom-tree.js";
import type {
  ElementDomNode,
  FlatDomTree,
  InteractiveElementDomNode,
  TextDomNode,
} from "./types.js";

const DEFAULT_VIEWPORT_EXPANSION = -1;

export function resolveViewportExpansion(viewportExpansion?: number): number {
  return viewportExpansion ?? DEFAULT_VIEWPORT_EXPANSION;
}

export interface DomConfig {
  viewportExpansion?: number;
  interactiveBlacklist?: (Element | (() => Element))[];
  interactiveWhitelist?: (Element | (() => Element))[];
  includeAttributes?: string[];
  highlightOpacity?: number;
  highlightLabelOpacity?: number;
}

const newElementsCache = new WeakMap<HTMLElement, string>();

export function getFlatTree(config: DomConfig): FlatDomTree {
  const viewportExpansion = resolveViewportExpansion(config.viewportExpansion);

  const interactiveBlacklist: Element[] = [];
  for (const item of config.interactiveBlacklist || []) {
    if (typeof item === "function") {
      interactiveBlacklist.push(item());
    } else {
      interactiveBlacklist.push(item);
    }
  }

  const interactiveWhitelist: Element[] = [];
  for (const item of config.interactiveWhitelist || []) {
    if (typeof item === "function") {
      interactiveWhitelist.push(item());
    } else {
      interactiveWhitelist.push(item);
    }
  }

  const elements = domTree({
    doHighlightElements: true,
    debugMode: true,
    focusHighlightIndex: -1,
    viewportExpansion,
    interactiveBlacklist,
    interactiveWhitelist,
    highlightOpacity: config.highlightOpacity ?? 0.0,
    highlightLabelOpacity: config.highlightLabelOpacity ?? 0.1,
  }) as FlatDomTree;

  for (const nodeId in elements.map) {
    const node = elements.map[nodeId];
    if (node.isInteractive && (node as any).ref) {
      const ref = (node as any).ref as HTMLElement;
      if (!newElementsCache.has(ref)) {
        newElementsCache.set(ref, window.location.href);
        (node as any).isNew = true;
      }
    }
  }

  return elements;
}

// ---- flatTreeToString ----

const globRegexCache = new Map<string, RegExp>();

function globToRegex(pattern: string): RegExp {
  let regex = globRegexCache.get(pattern);
  if (!regex) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
    globRegexCache.set(pattern, regex);
  }
  return regex;
}

function matchAttributes(
  attrs: Record<string, string>,
  patterns: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const regex = globToRegex(pattern);
      for (const key of Object.keys(attrs)) {
        if (regex.test(key) && attrs[key].trim()) {
          result[key] = attrs[key].trim();
        }
      }
    } else {
      const value = attrs[pattern];
      if (value && value.trim()) {
        result[pattern] = value.trim();
      }
    }
  }
  return result;
}

interface TreeNode {
  type: "text" | "element";
  parent: TreeNode | null;
  children: TreeNode[];
  isVisible: boolean;
  text?: string;
  tagName?: string;
  attributes?: Record<string, string>;
  isInteractive?: boolean;
  isTopElement?: boolean;
  isNew?: boolean;
  highlightIndex?: number;
  extra?: Record<string, any>;
}

export function flatTreeToString(
  flatTree: FlatDomTree,
  includeAttributes?: string[]
): string {
  const DEFAULT_INCLUDE_ATTRIBUTES = [
    "title",
    "type",
    "checked",
    "name",
    "role",
    "value",
    "placeholder",
    "data-date-format",
    "alt",
    "aria-label",
    "aria-expanded",
    "data-state",
    "aria-checked",
    "id",
    "for",
    "target",
    "aria-haspopup",
    "aria-controls",
    "aria-owns",
    "contenteditable",
  ];

  const includeAttrs = [
    ...(includeAttributes || []),
    ...DEFAULT_INCLUDE_ATTRIBUTES,
  ];

  const capTextLength = (text: string, maxLength: number): string => {
    if (text.length > maxLength) {
      return text.substring(0, maxLength) + "...";
    }
    return text;
  };

  const buildTreeNode = (nodeId: string): TreeNode | null => {
    const node = flatTree.map[nodeId];
    if (!node) return null;

    if (node.type === "TEXT_NODE") {
      const textNode = node as TextDomNode;
      return {
        type: "text",
        text: textNode.text,
        isVisible: textNode.isVisible,
        parent: null,
        children: [],
      };
    } else {
      const elementNode = node as ElementDomNode;
      const children: TreeNode[] = [];

      if (elementNode.children) {
        for (const childId of elementNode.children) {
          const child = buildTreeNode(childId);
          if (child) {
            children.push(child);
          }
        }
      }

      return {
        type: "element",
        tagName: elementNode.tagName,
        attributes: elementNode.attributes ?? {},
        isVisible: elementNode.isVisible ?? false,
        isInteractive: elementNode.isInteractive ?? false,
        isTopElement: elementNode.isTopElement ?? false,
        isNew: elementNode.isNew ?? false,
        highlightIndex: elementNode.highlightIndex,
        parent: null,
        children,
        extra: elementNode.extra ?? {},
      };
    }
  };

  const setParentReferences = (
    node: TreeNode,
    parent: TreeNode | null = null
  ) => {
    node.parent = parent;
    for (const child of node.children) {
      setParentReferences(child, node);
    }
  };

  const rootNode = buildTreeNode(flatTree.rootId);
  if (!rootNode) return "";

  setParentReferences(rootNode);

  const hasParentWithHighlightIndex = (node: TreeNode): boolean => {
    let current = node.parent;
    while (current) {
      if (
        current.type === "element" &&
        current.highlightIndex !== undefined
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  };

  const processNode = (
    node: TreeNode,
    depth: number,
    result: string[]
  ): void => {
    let nextDepth = depth;
    const depthStr = "\t".repeat(depth);

    if (node.type === "element") {
      if (node.highlightIndex !== undefined) {
        nextDepth += 1;

        const text = getAllTextTillNextClickableElement(node);
        let attributesHtmlStr = "";

        if (includeAttrs.length > 0 && node.attributes) {
          const attributesToInclude = matchAttributes(
            node.attributes,
            includeAttrs
          );

          const keys = Object.keys(attributesToInclude);
          if (keys.length > 1) {
            const keysToRemove = new Set<string>();
            const seenValues: Record<string, string> = {};

            for (const key of keys) {
              const value = attributesToInclude[key];
              if (value.length > 5) {
                if (value in seenValues) {
                  keysToRemove.add(key);
                } else {
                  seenValues[value] = key;
                }
              }
            }

            for (const key of keysToRemove) {
              delete attributesToInclude[key];
            }
          }

          if (attributesToInclude.role === node.tagName) {
            delete attributesToInclude.role;
          }

          const attrsToRemoveIfTextMatches = [
            "aria-label",
            "placeholder",
            "title",
          ];
          for (const attr of attrsToRemoveIfTextMatches) {
            if (
              attributesToInclude[attr] &&
              attributesToInclude[attr].toLowerCase().trim() ===
                text.toLowerCase().trim()
            ) {
              delete attributesToInclude[attr];
            }
          }

          if (Object.keys(attributesToInclude).length > 0) {
            attributesHtmlStr = Object.entries(attributesToInclude)
              .map(([key, value]) => `${key}=${capTextLength(value, 20)}`)
              .join(" ");
          }
        }

        const highlightIndicator = node.isNew
          ? `*[${node.highlightIndex}]`
          : `[${node.highlightIndex}]`;
        let line = `${depthStr}${highlightIndicator}<${node.tagName ?? ""}`;

        if (attributesHtmlStr) {
          line += ` ${attributesHtmlStr}`;
        }

        if (node.extra) {
          if (node.extra.scrollable) {
            let scrollDataText = "";
            if (node.extra.scrollData?.left)
              scrollDataText += `left=${node.extra.scrollData.left}, `;
            if (node.extra.scrollData?.top)
              scrollDataText += `top=${node.extra.scrollData.top}, `;
            if (node.extra.scrollData?.right)
              scrollDataText += `right=${node.extra.scrollData.right}, `;
            if (node.extra.scrollData?.bottom)
              scrollDataText += `bottom=${node.extra.scrollData.bottom}`;
            line += ` data-scrollable="${scrollDataText}"`;
          }
        }

        if (text) {
          const trimmedText = text.trim();
          if (!attributesHtmlStr) {
            line += " ";
          }
          line += `>${trimmedText}`;
        } else if (!attributesHtmlStr) {
          line += " ";
        }

        line += " />";
        result.push(line);
      }

      for (const child of node.children) {
        processNode(child, nextDepth, result);
      }
    } else if (node.type === "text") {
      if (hasParentWithHighlightIndex(node)) {
        return;
      }

      if (
        node.parent &&
        node.parent.type === "element" &&
        node.parent.isVisible &&
        node.parent.isTopElement
      ) {
        result.push(`${depthStr}${node.text ?? ""}`);
      }
    }
  };

  const result: string[] = [];
  processNode(rootNode, 0, result);
  return result.join("\n");
}

export const getAllTextTillNextClickableElement = (
  node: TreeNode,
  maxDepth = -1
): string => {
  const textParts: string[] = [];

  const collectText = (currentNode: TreeNode, currentDepth: number) => {
    if (maxDepth !== -1 && currentDepth > maxDepth) {
      return;
    }

    if (
      currentNode.type === "element" &&
      currentNode !== node &&
      currentNode.highlightIndex !== undefined
    ) {
      return;
    }

    if (currentNode.type === "text" && currentNode.text) {
      textParts.push(currentNode.text);
    } else if (currentNode.type === "element") {
      for (const child of currentNode.children) {
        collectText(child, currentDepth + 1);
      }
    }
  };

  collectText(node, 0);
  return textParts.join("\n").trim();
};

export function getSelectorMap(
  flatTree: FlatDomTree
): Map<number, InteractiveElementDomNode> {
  const selectorMap = new Map<number, InteractiveElementDomNode>();

  const keys = Object.keys(flatTree.map);
  for (const key of keys) {
    const node = flatTree.map[key];
    if (node.isInteractive && typeof node.highlightIndex === "number") {
      selectorMap.set(
        node.highlightIndex,
        node as InteractiveElementDomNode
      );
    }
  }

  return selectorMap;
}

export function getElementTextMap(simplifiedHTML: string) {
  const lines = simplifiedHTML
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const elementTextMap = new Map<number, string>();
  for (const line of lines) {
    const regex = /^\[(\d+)\]<[^>]+>([^<]*)/;
    const match = regex.exec(line);
    if (match) {
      const index = parseInt(match[1], 10);
      elementTextMap.set(index, line);
    }
  }
  return elementTextMap;
}

export function cleanUpHighlights() {
  const cleanupFunctions = (window as any)._highlightCleanupFunctions || [];
  for (const cleanup of cleanupFunctions) {
    if (typeof cleanup === "function") {
      cleanup();
    }
  }
  (window as any)._highlightCleanupFunctions = [];
}
