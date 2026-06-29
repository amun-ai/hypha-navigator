/**
 * Flat DOM tree types, adapted from @page-agent/page-controller.
 * Original: https://github.com/alibaba/page-agent (MIT License)
 */

export interface FlatDomTree {
  rootId: string;
  map: Record<string, DomNode>;
}

export type DomNode = TextDomNode | ElementDomNode | InteractiveElementDomNode;

export interface TextDomNode {
  type: "TEXT_NODE";
  text: string;
  isVisible: boolean;
  [key: string]: unknown;
}

export interface ElementDomNode {
  tagName: string;
  attributes?: Record<string, string>;
  xpath?: string;
  children?: string[];
  isVisible?: boolean;
  isTopElement?: boolean;
  isInViewport?: boolean;
  isNew?: boolean;
  isInteractive?: false;
  highlightIndex?: number;
  extra?: Record<string, any>;
  [key: string]: unknown;
}

export interface InteractiveElementDomNode {
  tagName: string;
  attributes?: Record<string, string>;
  xpath?: string;
  children?: string[];
  isVisible?: boolean;
  isTopElement?: boolean;
  isInViewport?: boolean;
  isInteractive: true;
  highlightIndex: number;
  ref: HTMLElement;
  [key: string]: unknown;
}
