/**
 * Type declaration for dom-tree.js (vendored from @page-agent/page-controller).
 */
import type { FlatDomTree } from "./types.js";

interface DomTreeArgs {
  doHighlightElements: boolean;
  focusHighlightIndex: number;
  viewportExpansion: number;
  debugMode: boolean;
  interactiveBlacklist: Element[];
  interactiveWhitelist: Element[];
  highlightOpacity: number;
  highlightLabelOpacity: number;
}

declare function domTree(args?: Partial<DomTreeArgs>): FlatDomTree;
export default domTree;
