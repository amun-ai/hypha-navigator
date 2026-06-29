/**
 * Screenshot capture service using html-to-image.
 *
 * Returns image data in a format directly usable by AI agents:
 *   - `base64`: raw base64 (no data: prefix) — what Claude/GPT image
 *     content fields expect.
 *   - `media_type`: e.g. "image/jpeg" — the MIME type to pair with base64.
 *   - `data_url`: full `data:image/jpeg;base64,...` URL for HTML/preview use.
 *
 * Images are aggressively downscaled by default (max 800px, JPEG q=0.6)
 * because most agent context windows can't tolerate multi-MB payloads.
 */
import { toPng, toJpeg } from "html-to-image";

/** Extract a useful string from an unknown error value. */
function errorMessage(err: any): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err instanceof Event) return `Event: ${err.type}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Split a `data:<mime>;base64,<...>` URL into its parts. Throws on malformed. */
function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const m = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("Output is not a valid data: URL");
  const mediaType = m[1];
  let payload = m[2];
  // If charset=utf-8 (no base64), html-to-image returned an SVG fallback —
  // which is unusable for agent vision. Reject so the caller knows.
  if (!/;base64/i.test(dataUrl)) {
    throw new Error(
      `Output is not base64-encoded (got ${mediaType}). Capture probably failed silently.`,
    );
  }
  return { mediaType, base64: payload };
}

/**
 * Resize an image data URL via a canvas. Returns a new data URL at the
 * requested format/quality, fitting within (maxWidth × maxHeight) without
 * distortion.
 */
async function resizeDataUrl(
  dataUrl: string,
  maxWidth: number,
  maxHeight: number,
  format: "png" | "jpeg",
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const srcW = img.naturalWidth;
        const srcH = img.naturalHeight;
        if (!srcW || !srcH) {
          reject(new Error("Captured image has zero dimensions"));
          return;
        }
        const scale = Math.min(maxWidth / srcW, maxHeight / srcH, 1);
        const dstW = Math.max(1, Math.round(srcW * scale));
        const dstH = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement("canvas");
        canvas.width = dstW;
        canvas.height = dstH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get 2D canvas context"));
          return;
        }
        if (format === "jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, dstW, dstH);
        }
        ctx.drawImage(img, 0, 0, dstW, dstH);
        const mime = format === "jpeg" ? "image/jpeg" : "image/png";
        const out = canvas.toDataURL(mime, quality);
        resolve({ dataUrl: out, width: dstW, height: dstH });
      } catch (drawErr: any) {
        reject(new Error(`Canvas resize failed: ${errorMessage(drawErr)}`));
      }
    };
    img.onerror = (ev) =>
      reject(
        new Error(
          `Failed to load captured image for resizing${
            ev instanceof Event ? ` (${ev.type})` : ""
          }`,
        ),
      );
    img.src = dataUrl;
  });
}

export async function takeScreenshot(
  selector?: string,
  format?: "png" | "jpeg",
  quality?: number,
  max_width?: number,
  max_height?: number,
  full_page?: boolean,
): Promise<
  | {
      base64: string;
      media_type: string;
      data_url: string;
      format: string;
      width: number;
      height: number;
      size_kb: number;
    }
  | { error: string }
> {
  // Agent-friendly defaults: JPEG at q=0.6, capped at 800px.
  // These are smaller than before because larger images crash some agents.
  const fmt = format ?? "jpeg";
  const qual = quality ?? 0.6;
  const maxW = max_width ?? 800;
  const maxH = max_height ?? 800;
  const capturePage = full_page ?? false;

  let target: Element | null;
  if (selector) {
    target = document.querySelector(selector);
    if (!target) {
      return { error: `No element found for selector: ${selector}` };
    }
  } else if (capturePage) {
    target = document.documentElement;
  } else {
    target = document.body;
  }

  try {
    const node = target as HTMLElement;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const TRANSPARENT_PIXEL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

    const captureOptions: any = {
      quality: qual,
      pixelRatio: 1,
      cacheBust: true,
      skipAutoScale: true,
      skipFonts: true,
      imagePlaceholder: TRANSPARENT_PIXEL,
      filter: (el: HTMLElement) => {
        return (
          el.id !== "hypha-debugger-host" &&
          el.id !== "hypha-debugger-cursor" &&
          el.id !== "playwright-highlight-container"
        );
      },
    };
    if (!selector && !capturePage) {
      captureOptions.width = viewportW;
      captureOptions.height = viewportH;
    }

    const runCapture = async (opts: any, timeoutMs = 15000) => {
      const capturePromise =
        fmt === "jpeg" ? toJpeg(node, opts) : toPng(node, opts);
      return Promise.race<string>([
        capturePromise,
        new Promise<string>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Screenshot capture timed out after ${timeoutMs}ms`),
              ),
            timeoutMs,
          ),
        ),
      ]);
    };

    let dataUrl: string;
    try {
      dataUrl = await runCapture(captureOptions);
    } catch (captureErr: any) {
      // Fallback: retry without images
      try {
        const noImagesOpts = {
          ...captureOptions,
          filter: (el: HTMLElement) => {
            if (!captureOptions.filter(el)) return false;
            const tag = el.tagName?.toLowerCase();
            return tag !== "img" && tag !== "picture" && tag !== "video";
          },
        };
        dataUrl = await runCapture(noImagesOpts, 10000);
      } catch (retryErr: any) {
        return {
          error: `Capture failed: ${errorMessage(captureErr)} (retry without images also failed: ${errorMessage(retryErr)})`,
        };
      }
    }

    // Resize + re-encode through canvas. This both downsizes and ensures
    // a clean base64 PNG/JPEG (rather than a possibly-broken html-to-image
    // SVG-via-data-URL that some agent runtimes reject).
    let resized: { dataUrl: string; width: number; height: number };
    try {
      resized = await resizeDataUrl(dataUrl, maxW, maxH, fmt, qual);
    } catch (resizeErr: any) {
      return {
        error: `Resize failed: ${errorMessage(resizeErr)} (this usually means the captured image was malformed; try lowering max_width or use full_page:false)`,
      };
    }

    // Validate the final data URL — should be data:image/jpeg;base64,...
    let parts: { mediaType: string; base64: string };
    try {
      parts = splitDataUrl(resized.dataUrl);
    } catch (validateErr: any) {
      return { error: `Output validation failed: ${errorMessage(validateErr)}` };
    }

    // Sanity-check: a valid JPEG/PNG is at least a few hundred bytes.
    if (parts.base64.length < 200) {
      return {
        error: `Output too small (${parts.base64.length} chars base64) — capture likely failed`,
      };
    }

    const sizeKb = Math.round((parts.base64.length * 0.75) / 1024);
    return {
      base64: parts.base64,
      media_type: parts.mediaType,
      data_url: resized.dataUrl,
      format: fmt,
      width: resized.width,
      height: resized.height,
      size_kb: sizeKb,
    };
  } catch (err: any) {
    return { error: `Screenshot failed: ${errorMessage(err)}` };
  }
}

takeScreenshot.__schema__ = {
  name: "takeScreenshot",
  description:
    "Capture a screenshot of the current viewport, a specific element, or the full page. " +
    "Downscaled to fit within max_width × max_height (default 800px) and JPEG-encoded at " +
    "quality 0.6 by default for agent-friendly payload sizes. " +
    "Returns: { base64, media_type, data_url, format, width, height, size_kb }. " +
    "Use `base64` (raw base64, no prefix) directly with Claude/GPT image content fields. " +
    "Use `data_url` for HTML <img src=...> previews. " +
    "On failure returns { error }.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "CSS selector of the element to capture. Omit to capture the viewport (or full page if full_page=true).",
      },
      format: {
        type: "string",
        enum: ["png", "jpeg"],
        description:
          'Image format. Default: "jpeg" (much smaller than PNG). Use "png" only when sharp text really matters.',
      },
      quality: {
        type: "number",
        description:
          "JPEG quality (0–1). Default: 0.6. Ignored for PNG. Lower = smaller payload.",
      },
      max_width: {
        type: "number",
        description:
          "Maximum output width in pixels. Default: 800. Image scaled down preserving aspect ratio.",
      },
      max_height: {
        type: "number",
        description:
          "Maximum output height in pixels. Default: 800. Image scaled down preserving aspect ratio.",
      },
      full_page: {
        type: "boolean",
        description:
          "If true, capture the entire scrollable page instead of just the viewport. Default: false.",
      },
    },
  },
};
