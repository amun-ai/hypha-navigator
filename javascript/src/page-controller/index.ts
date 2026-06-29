/**
 * PageController: manages DOM state and element interactions.
 * Adapted from @page-agent/page-controller (MIT License).
 *
 * This wraps the smart DOM analysis (interactive element detection,
 * indexed element map) and provides an API for external agents.
 */
import * as dom from "./dom.js";
import type { FlatDomTree, InteractiveElementDomNode } from "./types.js";
import {
  clickElement,
  getElementByIndex,
  inputTextElement,
  scrollHorizontally,
  scrollVertically,
  selectOptionElement,
} from "./actions.js";
import { getPageScrollInfo } from "./page-info.js";

export interface PageControllerConfig extends dom.DomConfig {}

export interface BrowserState {
  url: string;
  title: string;
  header: string;
  content: string;
  footer: string;
  element_count: number;
}

export interface ActionResult {
  success: boolean;
  message: string;
}

export class PageController {
  private config: PageControllerConfig;
  private flatTree: FlatDomTree | null = null;
  private selectorMap = new Map<number, InteractiveElementDomNode>();
  private elementTextMap = new Map<number, string>();
  private simplifiedHTML = "";
  private isIndexed = false;

  constructor(config: PageControllerConfig = {}) {
    this.config = config;
  }

  /**
   * Get structured browser state for LLM consumption.
   * Builds the DOM tree, highlights interactive elements, and returns
   * a simplified text representation with numeric indices.
   */
  async getBrowserState(): Promise<BrowserState> {
    const url = window.location.href;
    const title = document.title;
    const pi = getPageScrollInfo();
    const viewportExpansion = dom.resolveViewportExpansion(
      this.config.viewportExpansion
    );

    await this.updateTree();

    const content = this.simplifiedHTML;

    const titleLine = `Current Page: [${title}](${url})`;
    const pageInfoLine = `Page info: ${pi.viewport_width}x${pi.viewport_height}px viewport, ${pi.page_width}x${pi.page_height}px total, ${pi.pages_above.toFixed(1)} pages above, ${pi.pages_below.toFixed(1)} pages below, at ${(pi.current_page_position * 100).toFixed(0)}%`;

    const elementsLabel =
      viewportExpansion === -1
        ? "Interactive elements (full page):"
        : "Interactive elements (viewport):";

    const hasContentAbove = pi.pixels_above > 4;
    const scrollHintAbove =
      hasContentAbove && viewportExpansion !== -1
        ? `... ${pi.pixels_above} pixels above - scroll to see more ...`
        : "[Start of page]";

    const header = `${titleLine}\n${pageInfoLine}\n\n${elementsLabel}\n\n${scrollHintAbove}`;

    const hasContentBelow = pi.pixels_below > 4;
    const footer =
      hasContentBelow && viewportExpansion !== -1
        ? `... ${pi.pixels_below} pixels below - scroll to see more ...`
        : "[End of page]";

    return {
      url,
      title,
      header,
      content,
      footer,
      element_count: this.selectorMap.size,
    };
  }

  /**
   * Update DOM tree, returns simplified HTML for LLM.
   */
  async updateTree(): Promise<string> {
    dom.cleanUpHighlights();

    this.flatTree = dom.getFlatTree(this.config);
    this.simplifiedHTML = dom.flatTreeToString(
      this.flatTree,
      this.config.includeAttributes
    );

    this.selectorMap.clear();
    this.selectorMap = dom.getSelectorMap(this.flatTree);

    this.elementTextMap.clear();
    this.elementTextMap = dom.getElementTextMap(this.simplifiedHTML);

    this.isIndexed = true;

    return this.simplifiedHTML;
  }

  async cleanUpHighlights(): Promise<void> {
    dom.cleanUpHighlights();
  }

  private assertIndexed(): void {
    if (!this.isIndexed) {
      throw new Error(
        "DOM tree not indexed yet. Call get_browser_state first."
      );
    }
  }

  /** Clean up highlights after performing an action. */
  private cleanUpAfterAction(): void {
    dom.cleanUpHighlights();
  }

  async clickElement(index: number): Promise<ActionResult> {
    try {
      this.assertIndexed();
      const element = getElementByIndex(this.selectorMap, index);
      const elemText = this.elementTextMap.get(index);
      this.cleanUpAfterAction();
      await clickElement(element);

      if (
        element instanceof HTMLAnchorElement &&
        element.target === "_blank"
      ) {
        return {
          success: true,
          message: `Clicked element (${elemText ?? index}). Link opened in a new tab.`,
        };
      }

      return {
        success: true,
        message: `Clicked element (${elemText ?? index}).`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to click element: ${error}`,
      };
    }
  }

  async inputText(index: number, text: string): Promise<ActionResult> {
    try {
      this.assertIndexed();
      const element = getElementByIndex(this.selectorMap, index);
      const elemText = this.elementTextMap.get(index);
      this.cleanUpAfterAction();
      await inputTextElement(element, text);

      return {
        success: true,
        message: `Input text "${text}" into element (${elemText ?? index}).`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to input text: ${error}`,
      };
    }
  }

  async selectOption(
    index: number,
    optionText: string
  ): Promise<ActionResult> {
    try {
      this.assertIndexed();
      const element = getElementByIndex(this.selectorMap, index);
      const elemText = this.elementTextMap.get(index);
      this.cleanUpAfterAction();
      await selectOptionElement(element as HTMLSelectElement, optionText);

      return {
        success: true,
        message: `Selected option "${optionText}" in element (${elemText ?? index}).`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to select option: ${error}`,
      };
    }
  }

  async scroll(options: {
    direction: "up" | "down" | "left" | "right";
    amount?: number;
    index?: number;
  }): Promise<ActionResult> {
    try {
      this.assertIndexed();
      this.cleanUpAfterAction();

      const { direction, amount, index } = options;
      const element =
        index !== undefined
          ? getElementByIndex(this.selectorMap, index)
          : null;

      let message: string;

      if (direction === "left" || direction === "right") {
        const pixels = amount ?? window.innerWidth * 0.8;
        message = await scrollHorizontally(
          direction === "right",
          pixels,
          element
        );
      } else {
        const pixels = amount ?? window.innerHeight * 0.8;
        const scrollAmount = direction === "down" ? pixels : -pixels;
        message = await scrollVertically(
          direction === "down",
          scrollAmount,
          element
        );
      }

      return { success: true, message };
    } catch (error) {
      return {
        success: false,
        message: `Failed to scroll: ${error}`,
      };
    }
  }

  dispose(): void {
    dom.cleanUpHighlights();
    this.flatTree = null;
    this.selectorMap.clear();
    this.elementTextMap.clear();
    this.simplifiedHTML = "";
    this.isIndexed = false;
  }
}
