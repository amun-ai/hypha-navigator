/**
 * Navigation service with auto-reconnect support.
 *
 * For agent-triggered reload() and same-origin navigate(), we use a "soft"
 * approach: fetch the target HTML, inject the debugger <script> tag, then
 * replace the document via document.write(). The injected script auto-starts
 * from sessionStorage config, so the debugger reconnects with the same
 * workspace and service ID. The agent's URL stays stable.
 *
 * For cross-origin navigate(), goBack(), and goForward(), we fall back to
 * normal navigation. The debugger config is saved to sessionStorage so
 * re-clicking the bookmarklet reconnects seamlessly.
 */

const STORAGE_KEY = "__hypha_debugger_config__";

/** Read the saved script URL from sessionStorage, or fall back to CDN. */
function getScriptUrl(): string {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const config = JSON.parse(raw);
      if (config.script_url) return config.script_url;
    }
  } catch {
    // ignore
  }
  return "https://cdn.jsdelivr.net/npm/hypha-debugger/dist/hypha-debugger.min.js";
}

/**
 * Inject the debugger loader script into HTML before </body> (or append).
 */
function injectLoader(html: string, scriptUrl: string): string {
  const loader = `<script src="${scriptUrl}"><\/script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", loader + "\n</body>");
  }
  if (html.includes("</html>")) {
    return html.replace("</html>", loader + "\n</html>");
  }
  return html + "\n" + loader;
}

/**
 * Perform a soft page replacement: fetch HTML, inject debugger script,
 * replace the document via document.write(). If the fetch or write fails,
 * falls back to hard navigation.
 */
export function softReplace(url: string, pushState?: string): void {
  const scriptUrl = getScriptUrl();

  fetch(url, { credentials: "same-origin", cache: "reload" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        throw new Error("Not HTML");
      }
      return response.text();
    })
    .then((html) => {
      const modified = injectLoader(html, scriptUrl);
      document.open();
      document.write(modified);
      document.close();
      if (pushState) {
        try {
          history.pushState({}, "", pushState);
        } catch {
          // ignore — URL might already match
        }
      }
    })
    .catch(() => {
      // Soft replace failed — fall back to hard navigation
      if (pushState) {
        window.location.href = pushState;
      } else {
        window.location.reload();
      }
    });
}

/** Check if a URL is same-origin as the current page. */
function isSameOrigin(url: string): boolean {
  try {
    const target = new URL(url, location.href);
    return target.origin === location.origin;
  } catch {
    return false;
  }
}

// ── Global navigation interception ────────────────────────────────────

let _interceptInstalled = false;

/**
 * Install global listeners that intercept same-origin link clicks and
 * form submissions, routing them through soft navigation so the debugger
 * stays connected.
 *
 * Called once from HyphaDebugger.start().
 */
export function installNavigationInterceptor(): () => void {
  if (_interceptInstalled) return () => {};
  _interceptInstalled = true;

  /**
   * Click handler: intercept <a> clicks that would navigate to a
   * same-origin HTML page.
   */
  const onClick = (e: MouseEvent) => {
    // Skip if modifier keys (new tab, etc.) or not left-click
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    // Walk up from target to find the nearest <a>
    let anchor: HTMLAnchorElement | null = null;
    let el = e.target as HTMLElement | null;
    while (el) {
      if (el.tagName === "A") {
        anchor = el as HTMLAnchorElement;
        break;
      }
      el = el.parentElement;
    }
    if (!anchor) return;

    const href = anchor.href;
    if (!href) return;

    // Skip non-http(s), download links, target=_blank, javascript:, #hash-only
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;
    if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

    // Skip hash-only links (same page anchor)
    try {
      const target = new URL(href, location.href);
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        target.search === location.search &&
        target.hash !== location.hash
      ) {
        return; // Just a hash change, let browser handle it
      }
    } catch {
      return;
    }

    // Skip cross-origin
    if (!isSameOrigin(href)) return;

    // Intercept: prevent default navigation and do soft replace
    e.preventDefault();
    const targetUrl = new URL(href, location.href).href;
    softReplace(targetUrl, targetUrl);
  };

  /**
   * Submit handler: intercept form submissions to same-origin action URLs.
   * Only handles GET forms (POST forms need the request body which is harder
   * to replicate via fetch).
   */
  const onSubmit = (e: SubmitEvent) => {
    if (e.defaultPrevented) return;

    const form = e.target as HTMLFormElement;
    const method = (form.method || "GET").toUpperCase();

    // Only intercept GET forms — POST forms are too complex to replicate
    if (method !== "GET") return;

    const action = form.action || location.href;
    if (!isSameOrigin(action)) return;

    // Build the URL with form data as query params
    const formData = new FormData(form);
    const url = new URL(action, location.href);
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        url.searchParams.set(key, value);
      }
    }

    // Skip if target is _blank or similar
    if (form.target && form.target !== "_self") return;

    e.preventDefault();
    softReplace(url.href, url.href);
  };

  /**
   * Popstate handler: intercept browser back/forward (bfcache miss).
   * When the browser navigates via back/forward and there's no bfcache,
   * we can catch it via popstate and do a soft load of the target URL.
   */
  const onPopState = () => {
    // The URL has already changed when popstate fires.
    // Do a soft load of the current URL (which is the target of back/forward).
    softReplace(location.href);
  };

  document.addEventListener("click", onClick, true); // capture phase
  document.addEventListener("submit", onSubmit, true);
  window.addEventListener("popstate", onPopState);

  // Return cleanup function
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
    window.removeEventListener("popstate", onPopState);
    _interceptInstalled = false;
  };
}

// ── navigate ──────────────────────────────────────────────────────────

export function navigate(
  url: string
): { success: boolean; message: string } {
  try {
    const targetUrl = new URL(url, location.href);
    const sameOrigin = targetUrl.origin === location.origin;

    if (sameOrigin) {
      // Soft navigate: fetch + inject + document.write, then pushState
      // Schedule after RPC response is sent
      setTimeout(() => softReplace(targetUrl.href, targetUrl.href), 150);
      return {
        success: true,
        message: `Navigating to ${url} (debugger will auto-reconnect)`,
      };
    } else {
      // Cross-origin: can't soft navigate, fall back to hard
      window.location.href = url;
      return {
        success: true,
        message: `Navigating to ${url} (cross-origin, debugger will disconnect)`,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Navigation failed: ${err.message ?? err}`,
    };
  }
}

navigate.__schema__ = {
  name: "navigate",
  description:
    "Navigate the browser to a new URL. For same-origin URLs, the debugger auto-reconnects. Cross-origin navigation will disconnect the debugger.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to navigate to.",
      },
    },
    required: ["url"],
  },
};

// ── goBack / goForward ───────────────────────────────────────────────

export function goBack(): { success: boolean; message: string } {
  try {
    window.history.back();
    return {
      success: true,
      message: "Navigated back (debugger will auto-reconnect via popstate)",
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Back navigation failed: ${err.message ?? err}`,
    };
  }
}

goBack.__schema__ = {
  name: "goBack",
  description:
    "Navigate back in browser history. The debugger auto-reconnects for same-origin pages.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export function goForward(): { success: boolean; message: string } {
  try {
    window.history.forward();
    return {
      success: true,
      message: "Navigated forward (debugger will auto-reconnect via popstate)",
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Forward navigation failed: ${err.message ?? err}`,
    };
  }
}

goForward.__schema__ = {
  name: "goForward",
  description:
    "Navigate forward in browser history. The debugger auto-reconnects for same-origin pages.",
  parameters: {
    type: "object",
    properties: {},
  },
};

// ── reload ───────────────────────────────────────────────────────────

export function reload(): { success: boolean; message: string } {
  try {
    // Schedule soft reload after RPC response is sent
    setTimeout(() => softReplace(location.href), 150);
    return {
      success: true,
      message: "Reloading page (debugger will auto-reconnect)",
    };
  } catch (err: any) {
    return { success: false, message: `Reload failed: ${err.message ?? err}` };
  }
}

reload.__schema__ = {
  name: "reload",
  description:
    "Reload the current page. The debugger auto-reconnects after reload using soft page replacement.",
  parameters: {
    type: "object",
    properties: {},
  },
};
