/**
 * Animated AI cursor overlay.
 * Shows a smooth-moving cursor with click ripple animation.
 * Adapted from @page-agent/page-controller (MIT License).
 *
 * The cursor is injected as a fixed overlay and listens for
 * custom events dispatched by the page-controller actions.
 */

// SVG cursor graphics (inlined to avoid external file dependencies)
const CURSOR_BORDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><g><path d="M 15 42 L 15 36.99 Q 15 31.99 23.7 31.99 L 28.05 31.99 Q 32.41 31.99 32.41 21.99 L 32.41 17 Q 32.41 12 41.09 16.95 L 76.31 37.05 Q 85 42 76.31 46.95 L 41.09 67.05 Q 32.41 72 32.41 62.01 L 32.41 57.01 Q 32.41 52.01 23.7 52.01 L 19.35 52.01 Q 15 52.01 15 47.01 Z" fill="none" stroke="currentColor" stroke-width="6" stroke-miterlimit="10"/></g></svg>`;

const CURSOR_FILL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g style="filter: drop-shadow(rgba(0, 0, 0, 0.3) 3px 4px 4px);"><path d="M 15 42 L 15 36.99 Q 15 31.99 23.7 31.99 L 28.05 31.99 Q 32.41 31.99 32.41 21.99 L 32.41 17 Q 32.41 12 41.09 16.95 L 76.31 37.05 Q 85 42 76.31 46.95 L 41.09 67.05 Q 32.41 72 32.41 62.01 L 32.41 57.01 Q 32.41 52.01 23.7 52.01 L 19.35 52.01 Q 15 52.01 15 47.01 Z" fill="#ffffff" stroke="none"/></g></svg>`;

const CURSOR_CSS = `
  .hypha-cursor {
    position: fixed;
    width: 50px;
    height: 50px;
    pointer-events: none;
    z-index: 2147483646;
    transition: opacity 0.2s;
    opacity: 0;
  }
  .hypha-cursor.visible {
    opacity: 1;
  }
  .hypha-cursor-border {
    position: absolute;
    width: 100%;
    height: 100%;
    background: linear-gradient(45deg, rgb(57, 182, 255), rgb(189, 69, 251));
    mask-image: var(--cursor-border);
    -webkit-mask-image: var(--cursor-border);
    mask-size: 100% 100%;
    -webkit-mask-size: 100% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    transform-origin: center;
    transform: rotate(-135deg) scale(1.2);
    margin-left: -10px;
    margin-top: -14px;
  }
  .hypha-cursor-fill {
    position: absolute;
    width: 100%;
    height: 100%;
    background-image: var(--cursor-fill);
    background-size: 100% 100%;
    background-repeat: no-repeat;
    transform-origin: center;
    transform: rotate(-135deg) scale(1.2);
    margin-left: -10px;
    margin-top: -14px;
  }
  .hypha-cursor-ripple {
    position: absolute;
    width: 100%;
    height: 100%;
    pointer-events: none;
    margin-left: -50%;
    margin-top: -50%;
  }
  .hypha-cursor-ripple::after {
    content: '';
    opacity: 0;
    position: absolute;
    inset: 0;
    border: 3px solid rgba(57, 182, 255, 1);
    border-radius: 50%;
  }
  .hypha-cursor.clicking .hypha-cursor-ripple::after {
    animation: hypha-cursor-ripple 400ms ease-out forwards;
  }
  @keyframes hypha-cursor-ripple {
    0% { transform: scale(0); opacity: 1; }
    100% { transform: scale(2.5); opacity: 0; }
  }
`;

export class AICursor {
  private container: HTMLDivElement;
  private cursor: HTMLDivElement;
  private currentX = 0;
  private currentY = 0;
  private targetX = 0;
  private targetY = 0;
  private animating = false;
  private visible = false;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Create container (not in Shadow DOM — needs to be on top of everything)
    this.container = document.createElement("div");
    this.container.id = "hypha-debugger-cursor";
    this.container.setAttribute("data-browser-use-ignore", "true");
    this.container.setAttribute("data-page-agent-ignore", "true");

    // Inject styles
    const style = document.createElement("style");
    style.textContent = CURSOR_CSS;
    this.container.appendChild(style);

    // Create cursor element
    this.cursor = document.createElement("div");
    this.cursor.className = "hypha-cursor";

    // Set SVG as CSS custom properties (data URIs for mask-image)
    const borderDataUri =
      "url(\"data:image/svg+xml," +
      encodeURIComponent(CURSOR_BORDER_SVG) +
      '")';
    const fillDataUri =
      "url(\"data:image/svg+xml," +
      encodeURIComponent(CURSOR_FILL_SVG) +
      '")';
    this.cursor.style.setProperty("--cursor-border", borderDataUri);
    this.cursor.style.setProperty("--cursor-fill", fillDataUri);

    // Ripple layer (behind cursor)
    const ripple = document.createElement("div");
    ripple.className = "hypha-cursor-ripple";
    this.cursor.appendChild(ripple);

    // Fill layer (white arrow with shadow)
    const fill = document.createElement("div");
    fill.className = "hypha-cursor-fill";
    this.cursor.appendChild(fill);

    // Border layer (gradient)
    const border = document.createElement("div");
    border.className = "hypha-cursor-border";
    this.cursor.appendChild(border);

    this.container.appendChild(this.cursor);
    document.body.appendChild(this.container);

    // Listen for move/click events from actions
    window.addEventListener("HyphaDebugger::MovePointerTo", ((
      event: CustomEvent
    ) => {
      const { x, y } = event.detail;
      this.moveTo(x, y);
    }) as EventListener);

    window.addEventListener("HyphaDebugger::ClickPointer", () => {
      this.triggerClickAnimation();
    });
  }

  moveTo(x: number, y: number) {
    this.targetX = x;
    this.targetY = y;

    // Show cursor
    if (!this.visible) {
      this.visible = true;
      this.currentX = x;
      this.currentY = y;
      this.cursor.style.left = `${x}px`;
      this.cursor.style.top = `${y}px`;
      this.cursor.classList.add("visible");
    }

    // Cancel any pending hide
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    // Start animation loop if not running
    if (!this.animating) {
      this.animating = true;
      this.animateLoop();
    }
  }

  private animateLoop() {
    const ease = 0.18;
    const dx = this.targetX - this.currentX;
    const dy = this.targetY - this.currentY;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      this.currentX += dx * ease;
      this.currentY += dy * ease;
      this.cursor.style.left = `${this.currentX}px`;
      this.cursor.style.top = `${this.currentY}px`;
      requestAnimationFrame(() => this.animateLoop());
    } else {
      // Snap to target
      this.currentX = this.targetX;
      this.currentY = this.targetY;
      this.cursor.style.left = `${this.currentX}px`;
      this.cursor.style.top = `${this.currentY}px`;
      this.animating = false;

      // Auto-hide cursor after 2s of inactivity
      this.hideTimeout = setTimeout(() => {
        this.visible = false;
        this.cursor.classList.remove("visible");
      }, 2000);
    }
  }

  triggerClickAnimation() {
    this.cursor.classList.remove("clicking");
    // Force reflow to restart CSS animation
    void this.cursor.offsetHeight;
    this.cursor.classList.add("clicking");
  }

  destroy() {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.container.remove();
  }
}
