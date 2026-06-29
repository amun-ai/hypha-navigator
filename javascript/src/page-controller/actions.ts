/**
 * Element interaction actions: click, input, select, scroll.
 * Adapted from @page-agent/page-controller (MIT License).
 */
import type { InteractiveElementDomNode } from "./types.js";

async function waitFor(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function getElementByIndex(
  selectorMap: Map<number, InteractiveElementDomNode>,
  index: number
): HTMLElement {
  const interactiveNode = selectorMap.get(index);
  if (!interactiveNode) {
    throw new Error(`No interactive element found at index ${index}`);
  }

  const element = interactiveNode.ref;
  if (!element) {
    throw new Error(`Element at index ${index} does not have a reference`);
  }

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Element at index ${index} is not an HTMLElement`);
  }

  return element;
}

let lastClickedElement: HTMLElement | null = null;

function blurLastClickedElement() {
  if (lastClickedElement) {
    lastClickedElement.blur();
    lastClickedElement.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, cancelable: true })
    );
    lastClickedElement = null;
  }
}

export async function scrollIntoViewIfNeeded(element: HTMLElement) {
  // Check if element is already in viewport
  const rect = element.getBoundingClientRect();
  const inViewport =
    rect.top >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.left >= 0 &&
    rect.right <= window.innerWidth;

  if (!inViewport) {
    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    // Wait for smooth scroll animation to settle
    await waitFor(0.4);
  }
}

/** Move the visual AI cursor to the center of an element. */
async function movePointerToElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  window.dispatchEvent(
    new CustomEvent("HyphaDebugger::MovePointerTo", { detail: { x, y } })
  );
  await waitFor(0.3); // wait for cursor animation
}

export async function clickElement(element: HTMLElement) {
  blurLastClickedElement();

  lastClickedElement = element;
  await scrollIntoViewIfNeeded(element);
  await movePointerToElement(element);

  // Trigger click ripple animation
  window.dispatchEvent(new CustomEvent("HyphaDebugger::ClickPointer"));
  await waitFor(0.05);

  // hover
  element.dispatchEvent(
    new MouseEvent("mouseenter", { bubbles: true, cancelable: true })
  );
  element.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, cancelable: true })
  );

  // mouse sequence
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true })
  );

  element.focus();

  element.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, cancelable: true })
  );
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true })
  );

  await waitFor(0.2);
}

// Lazy-initialized to avoid "window is not defined" in Node/SSR
let _nativeInputValueSetter: ((v: string) => void) | null = null;
let _nativeTextAreaValueSetter: ((v: string) => void) | null = null;

function getNativeInputValueSetter(): (v: string) => void {
  if (!_nativeInputValueSetter) {
    _nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
  }
  return _nativeInputValueSetter;
}

function getNativeTextAreaValueSetter(): (v: string) => void {
  if (!_nativeTextAreaValueSetter) {
    _nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )!.set!;
  }
  return _nativeTextAreaValueSetter;
}

export async function inputTextElement(element: HTMLElement, text: string) {
  const isContentEditable = element.isContentEditable;
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement) &&
    !isContentEditable
  ) {
    throw new Error("Element is not an input, textarea, or contenteditable");
  }

  await clickElement(element);

  if (isContentEditable) {
    // Clear
    if (
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContent",
        })
      )
    ) {
      element.innerText = "";
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContent",
        })
      );
    }

    // Insert
    if (
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        })
      )
    ) {
      element.innerText = text;
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        })
      );
    }

    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  } else if (element instanceof HTMLTextAreaElement) {
    getNativeTextAreaValueSetter().call(element, text);
  } else {
    getNativeInputValueSetter().call(element, text);
  }

  if (!isContentEditable) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  await waitFor(0.1);
  blurLastClickedElement();
}

export async function selectOptionElement(
  selectElement: HTMLSelectElement,
  optionText: string
) {
  if (!(selectElement instanceof HTMLSelectElement)) {
    throw new Error("Element is not a select element");
  }

  await scrollIntoViewIfNeeded(selectElement);

  // Move cursor to element
  const rect = selectElement.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent("HyphaDebugger::MovePointerTo", {
      detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    })
  );
  await waitFor(0.3);
  window.dispatchEvent(new CustomEvent("HyphaDebugger::ClickPointer"));

  const options = Array.from(selectElement.options);
  const option = options.find(
    (opt) => opt.textContent?.trim() === optionText.trim()
  );

  if (!option) {
    throw new Error(
      `Option with text "${optionText}" not found in select element`
    );
  }

  selectElement.value = option.value;
  selectElement.dispatchEvent(new Event("change", { bubbles: true }));

  await waitFor(0.1);
}

export async function scrollVertically(
  down: boolean,
  scroll_amount: number,
  element?: HTMLElement | null
) {
  if (element) {
    let currentElement = element as HTMLElement | null;
    let scrollSuccess = false;
    let scrolledElement: HTMLElement | null = null;
    let scrollDelta = 0;
    let attempts = 0;
    const dy = scroll_amount;

    while (currentElement && attempts < 10) {
      const computedStyle = window.getComputedStyle(currentElement);
      const hasScrollableY = /(auto|scroll|overlay)/.test(
        computedStyle.overflowY
      );
      const canScrollVertically =
        currentElement.scrollHeight > currentElement.clientHeight;

      if (hasScrollableY && canScrollVertically) {
        const beforeScroll = currentElement.scrollTop;
        const maxScroll =
          currentElement.scrollHeight - currentElement.clientHeight;

        let scrollAmount = dy / 3;
        if (scrollAmount > 0) {
          scrollAmount = Math.min(scrollAmount, maxScroll - beforeScroll);
        } else {
          scrollAmount = Math.max(scrollAmount, -beforeScroll);
        }

        currentElement.scrollTop = beforeScroll + scrollAmount;

        const afterScroll = currentElement.scrollTop;
        const actualScrollDelta = afterScroll - beforeScroll;

        if (Math.abs(actualScrollDelta) > 0.5) {
          scrollSuccess = true;
          scrolledElement = currentElement;
          scrollDelta = actualScrollDelta;
          break;
        }
      }

      if (
        currentElement === document.body ||
        currentElement === document.documentElement
      ) {
        break;
      }
      currentElement = currentElement.parentElement;
      attempts++;
    }

    if (scrollSuccess) {
      return `Scrolled container (${scrolledElement?.tagName}) by ${scrollDelta}px`;
    } else {
      return `No scrollable container found for element (${element.tagName})`;
    }
  }

  // Page-level scrolling
  const dy = scroll_amount;
  const bigEnough = (el: HTMLElement) =>
    el.clientHeight >= window.innerHeight * 0.5;
  const canScroll = (el: HTMLElement | null) =>
    el &&
    /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) &&
    el.scrollHeight > el.clientHeight &&
    bigEnough(el);

  let el: HTMLElement | null = document.activeElement as HTMLElement | null;
  while (el && !canScroll(el) && el !== document.body) el = el.parentElement;

  el = canScroll(el)
    ? el
    : Array.from(document.querySelectorAll<HTMLElement>("*")).find(canScroll) ||
      (document.scrollingElement as HTMLElement) ||
      (document.documentElement as HTMLElement);

  if (
    el === document.scrollingElement ||
    el === document.documentElement ||
    el === document.body
  ) {
    const scrollBefore = window.scrollY;
    window.scrollBy(0, dy);
    const scrollAfter = window.scrollY;
    const scrolled = scrollAfter - scrollBefore;

    if (Math.abs(scrolled) < 1) {
      return dy > 0
        ? "Already at the bottom of the page."
        : "Already at the top of the page.";
    }

    const scrollMax =
      document.documentElement.scrollHeight - window.innerHeight;
    const reachedBottom = dy > 0 && scrollAfter >= scrollMax - 1;
    const reachedTop = dy < 0 && scrollAfter <= 1;

    if (reachedBottom)
      return `Scrolled page by ${scrolled}px. Reached the bottom.`;
    if (reachedTop) return `Scrolled page by ${scrolled}px. Reached the top.`;
    return `Scrolled page by ${scrolled}px.`;
  } else {
    const scrollBefore = el!.scrollTop;
    const scrollMax = el!.scrollHeight - el!.clientHeight;

    el!.scrollBy({ top: dy, behavior: "smooth" });
    await waitFor(0.1);

    const scrollAfter = el!.scrollTop;
    const scrolled = scrollAfter - scrollBefore;

    if (Math.abs(scrolled) < 1) {
      return dy > 0
        ? `Already at the bottom of container (${el!.tagName}).`
        : `Already at the top of container (${el!.tagName}).`;
    }

    const reachedBottom = dy > 0 && scrollAfter >= scrollMax - 1;
    const reachedTop = dy < 0 && scrollAfter <= 1;

    if (reachedBottom)
      return `Scrolled container (${el!.tagName}) by ${scrolled}px. Reached the bottom.`;
    if (reachedTop)
      return `Scrolled container (${el!.tagName}) by ${scrolled}px. Reached the top.`;
    return `Scrolled container (${el!.tagName}) by ${scrolled}px.`;
  }
}

export async function scrollHorizontally(
  right: boolean,
  scroll_amount: number,
  element?: HTMLElement | null
) {
  if (element) {
    let currentElement = element as HTMLElement | null;
    let scrollSuccess = false;
    let scrolledElement: HTMLElement | null = null;
    let scrollDelta = 0;
    let attempts = 0;
    const dx = right ? scroll_amount : -scroll_amount;

    while (currentElement && attempts < 10) {
      const computedStyle = window.getComputedStyle(currentElement);
      const hasScrollableX = /(auto|scroll|overlay)/.test(
        computedStyle.overflowX
      );
      const canScrollHorizontally =
        currentElement.scrollWidth > currentElement.clientWidth;

      if (hasScrollableX && canScrollHorizontally) {
        const beforeScroll = currentElement.scrollLeft;
        const maxScroll =
          currentElement.scrollWidth - currentElement.clientWidth;

        let scrollAmount = dx / 3;
        if (scrollAmount > 0) {
          scrollAmount = Math.min(scrollAmount, maxScroll - beforeScroll);
        } else {
          scrollAmount = Math.max(scrollAmount, -beforeScroll);
        }

        currentElement.scrollLeft = beforeScroll + scrollAmount;

        const afterScroll = currentElement.scrollLeft;
        const actualScrollDelta = afterScroll - beforeScroll;

        if (Math.abs(actualScrollDelta) > 0.5) {
          scrollSuccess = true;
          scrolledElement = currentElement;
          scrollDelta = actualScrollDelta;
          break;
        }
      }

      if (
        currentElement === document.body ||
        currentElement === document.documentElement
      ) {
        break;
      }
      currentElement = currentElement.parentElement;
      attempts++;
    }

    if (scrollSuccess) {
      return `Scrolled container (${scrolledElement?.tagName}) horizontally by ${scrollDelta}px`;
    } else {
      return `No horizontally scrollable container found for element (${element.tagName})`;
    }
  }

  // Page-level horizontal scroll
  const dx = right ? scroll_amount : -scroll_amount;
  const bigEnough = (el: HTMLElement) =>
    el.clientWidth >= window.innerWidth * 0.5;
  const canScroll = (el: HTMLElement | null) =>
    el &&
    /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowX) &&
    el.scrollWidth > el.clientWidth &&
    bigEnough(el);

  let el: HTMLElement | null = document.activeElement as HTMLElement | null;
  while (el && !canScroll(el) && el !== document.body) el = el.parentElement;

  el = canScroll(el)
    ? el
    : Array.from(document.querySelectorAll<HTMLElement>("*")).find(canScroll) ||
      (document.scrollingElement as HTMLElement) ||
      (document.documentElement as HTMLElement);

  if (
    el === document.scrollingElement ||
    el === document.documentElement ||
    el === document.body
  ) {
    const scrollBefore = window.scrollX;
    const scrollMax =
      document.documentElement.scrollWidth - window.innerWidth;

    window.scrollBy(dx, 0);

    const scrollAfter = window.scrollX;
    const scrolled = scrollAfter - scrollBefore;

    if (Math.abs(scrolled) < 1) {
      return dx > 0
        ? "Already at the right edge of the page."
        : "Already at the left edge of the page.";
    }

    const reachedRight = dx > 0 && scrollAfter >= scrollMax - 1;
    const reachedLeft = dx < 0 && scrollAfter <= 1;

    if (reachedRight)
      return `Scrolled page by ${scrolled}px. Reached the right edge.`;
    if (reachedLeft)
      return `Scrolled page by ${scrolled}px. Reached the left edge.`;
    return `Scrolled page horizontally by ${scrolled}px.`;
  } else {
    const scrollBefore = el!.scrollLeft;
    const scrollMax = el!.scrollWidth - el!.clientWidth;

    el!.scrollBy({ left: dx, behavior: "smooth" });
    await waitFor(0.1);

    const scrollAfter = el!.scrollLeft;
    const scrolled = scrollAfter - scrollBefore;

    if (Math.abs(scrolled) < 1) {
      return dx > 0
        ? `Already at the right edge of container (${el!.tagName}).`
        : `Already at the left edge of container (${el!.tagName}).`;
    }

    const reachedRight = dx > 0 && scrollAfter >= scrollMax - 1;
    const reachedLeft = dx < 0 && scrollAfter <= 1;

    if (reachedRight)
      return `Scrolled container (${el!.tagName}) by ${scrolled}px. Reached the right edge.`;
    if (reachedLeft)
      return `Scrolled container (${el!.tagName}) by ${scrolled}px. Reached the left edge.`;
    return `Scrolled container (${el!.tagName}) horizontally by ${scrolled}px.`;
  }
}
