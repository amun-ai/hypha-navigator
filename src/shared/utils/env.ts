/**
 * Environment detection and page metadata collection.
 */

export interface PageInfo {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  document_size: { width: number; height: number };
  user_agent: string;
  timestamp: string;
  cookies_enabled: boolean;
  language: string;
  platform: string;
  online: boolean;
  performance: {
    load_time_ms: number | null;
    dom_content_loaded_ms: number | null;
  };
  frameworks: string[];
}

export function detectFrameworks(): string[] {
  const frameworks: string[] = [];
  const w = window as any;

  // React
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size > 0) {
    frameworks.push("react");
  } else {
    const root = document.querySelector("#root, #app, [data-reactroot]");
    if (root) {
      const hasReactFiber = Object.keys(root).some(
        (k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$")
      );
      if (hasReactFiber) frameworks.push("react");
    }
  }

  // Vue
  if (w.__VUE__ || w.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    frameworks.push("vue");
  } else {
    const el = document.querySelector("[data-v-app], #app");
    if (el && (el as any).__vue_app__) frameworks.push("vue");
  }

  // Angular
  if (w.ng || document.querySelector("[ng-version]")) {
    frameworks.push("angular");
  }

  // Svelte
  if (document.querySelector("[class*='svelte-']")) {
    frameworks.push("svelte");
  }

  // Next.js
  if (w.__NEXT_DATA__) {
    frameworks.push("nextjs");
  }

  return frameworks;
}

export function collectPageInfo(): PageInfo {
  const perf = performance.getEntriesByType(
    "navigation"
  )[0] as PerformanceNavigationTiming | undefined;

  return {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    document_size: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    user_agent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    cookies_enabled: navigator.cookieEnabled,
    language: navigator.language,
    platform: navigator.platform,
    online: navigator.onLine,
    performance: {
      load_time_ms: perf ? Math.round(perf.loadEventEnd - perf.startTime) : null,
      dom_content_loaded_ms: perf
        ? Math.round(perf.domContentLoadedEventEnd - perf.startTime)
        : null,
    },
    frameworks: detectFrameworks(),
  };
}
