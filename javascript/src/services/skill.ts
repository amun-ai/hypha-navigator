/**
 * Dynamic SKILL.md generation following the agentskills.io specification.
 * Generates documentation from registered service function schemas.
 */

interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}

interface FunctionSchema {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
}

/**
 * Generate a SKILL.md document from a service definition.
 * Excludes credentials (service URL, token) — those are provided separately.
 */
export function generateSkillMd(
  serviceFunctions: Record<string, { __schema__?: FunctionSchema }>,
  serviceUrl: string,
  pageContext?: { title?: string; url?: string },
  guidance?: string
): string {
  const frontmatter = [
    "---",
    "name: web-debugger",
    "description: A Hypha debugger injected into a LIVE web page in a real browser. Remotely inspect the DOM, take screenshots, run JavaScript, fill forms, click/type by index, inspect React, and navigate — all via HTTP API calls.",
    "compatibility: Requires network access to the Hypha server. Works with any HTTP client (curl, fetch, Python requests).",
    "metadata:",
    '  version: "0.1"',
    '  author: "hypha-debugger"',
    "---",
  ].join("\n");

  const attached =
    pageContext?.title || pageContext?.url
      ? `**Currently attached to:** ${pageContext.title ? `"${pageContext.title}"` : ""}${pageContext.url ? ` — ${pageContext.url}` : ""} (call \`get_page_info\` for live details).`
      : "Call `get_page_info` to see the page you are attached to.";

  const intro = [
    "",
    "# Web Debugger — control a live web page",
    "",
    "**What this is:** a Hypha debugger has been injected into a LIVE web page running in a real browser, and this document is its HTTP API. You (an AI agent) can remotely inspect and control that exact page — read and modify the DOM, click and type, take screenshots, run JavaScript, and inspect React components. Changes you make are applied to the real page immediately.",
    "",
    attached,
    "",
    "Every function below is an HTTP endpoint under the service URL. Pick the approach that fits your task — they combine freely.",
    ...(guidance ? ["", guidance] : []),
    "",
    "## Approaches",
    "",
    "### execute_script — Run Arbitrary JavaScript",
    "",
    "The most versatile function. Use it to read/modify page state, call APIs, query the DOM,",
    "or do anything JavaScript can do. The last expression is auto-returned (no need for `return`).",
    "",
    "```bash",
    `# Read page state`,
    `curl -X POST '{SERVICE_URL}/execute_script' \\`,
    `  -H 'Content-Type: application/json' -d '{"code": "document.title"}'`,
    "",
    `# Query DOM`,
    `curl -X POST '{SERVICE_URL}/execute_script' \\`,
    `  -H 'Content-Type: application/json' -d '{"code": "document.querySelector(\\\"h1\\\").textContent"}'`,
    "",
    `# Call an API`,
    `curl -X POST '{SERVICE_URL}/execute_script' \\`,
    `  -H 'Content-Type: application/json' -d '{"code": "await fetch(\\\"/api/data\\\").then(r => r.json())"}'`,
    "",
    `# Modify the page`,
    `curl -X POST '{SERVICE_URL}/execute_script' \\`,
    `  -H 'Content-Type: application/json' -d '{"code": "document.getElementById(\\\"name\\\").value = \\\"Alice\\\""}'`,
    "```",
    "",
    "### get_browser_state + Index-Based Interaction",
    "",
    "Best for UI interaction as a user would — clicking buttons, filling forms, selecting options.",
    "All interactive elements are detected and indexed as `[0]`, `[1]`, `[2]`, etc.",
    "",
    "```bash",
    `# Step 1: See all interactive elements`,
    `curl '{SERVICE_URL}/get_browser_state'`,
    "",
    `# Step 2: Act by index`,
    `curl -X POST '{SERVICE_URL}/click_element_by_index' \\`,
    `  -H 'Content-Type: application/json' -d '{"index": 2}'`,
    "",
    `curl -X POST '{SERVICE_URL}/input_text' \\`,
    `  -H 'Content-Type: application/json' -d '{"index": 1, "text": "hello world"}'`,
    "",
    `curl -X POST '{SERVICE_URL}/select_option' \\`,
    `  -H 'Content-Type: application/json' -d '{"index": 3, "option_text": "French"}'`,
    "",
    `curl -X POST '{SERVICE_URL}/scroll' \\`,
    `  -H 'Content-Type: application/json' -d '{"direction": "down"}'`,
    "",
    `# Step 3: Verify visually`,
    `curl '{SERVICE_URL}/take_screenshot'`,
    "```",
    "",
    "### get_react_tree — Inspect React Components",
    "",
    "If the page uses React, inspect component names, props, state, and hooks:",
    "```bash",
    `curl '{SERVICE_URL}/get_react_tree'`,
    "```",
    "",
    "### CSS Selector-Based Functions",
    "",
    "Use CSS selectors directly when you know the element:",
    "```bash",
    `curl -X POST '{SERVICE_URL}/click_element' \\`,
    `  -H 'Content-Type: application/json' -d '{"selector": "button.submit"}'`,
    "",
    `curl -X POST '{SERVICE_URL}/fill_input' \\`,
    `  -H 'Content-Type: application/json' -d '{"selector": "#email", "value": "user@example.com"}'`,
    "",
    `curl -X POST '{SERVICE_URL}/query_dom' \\`,
    `  -H 'Content-Type: application/json' -d '{"selector": ".product-card"}'`,
    "```",
    "",
    "## How to call functions",
    "",
    "All functions are available as HTTP endpoints. Replace `{SERVICE_URL}` with the actual service URL.",
    "",
    "- **GET** for functions with no required parameters",
    "- **POST** with JSON body for functions with parameters",
    "- Append `?_mode=last` to resolve the most recent instance (recommended after page reloads where the clientId changes)",
    "",
    "## Response format",
    "",
    "All functions return JSON. There are three patterns:",
    "",
    "**1. Data-returning functions** (e.g. `take_screenshot`, `get_page_info`, `execute_script`, `get_browser_state`, `get_html`, `get_react_tree`) return function-specific keys:",
    "",
    "- `take_screenshot` → `{base64, media_type, data_url, format, width, height, size_kb}`. Use `base64` (raw, no prefix) for Claude/GPT image content fields. Use `data_url` for HTML `<img src=...>` previews.",
    "- `execute_script` → `{result, type}` (or `{error}` on exception)",
    "- `get_browser_state` → `{url, title, header, content, footer, element_count}`",
    "- `get_page_info` → `{url, title, viewport_width, viewport_height, ...}`",
    "- `get_html` → `{html, length, truncated}`",
    "",
    "**2. Action functions** (e.g. `click_*`, `input_text`, `select_option`, `scroll`, `navigate`) return:",
    "",
    "- `{success: true, message: \"...\"}` — action succeeded",
    "- `{success: false, message: \"...\"}` — action failed (element not found, etc.)",
    "",
    "**3. Errors from the Hypha gateway** (NOT from the service itself) return:",
    "",
    "- `{success: false, detail: \"...\"}` — e.g. service not found, call timed out, disconnected. If you see this, the browser tab is probably closed or the debugger crashed.",
    "",
  ].join("\n");

  // Build the function reference
  const functionDocs: string[] = ["## Available Functions", ""];

  const entries = Object.entries(serviceFunctions).filter(
    ([name, fn]) => fn?.__schema__ && name !== "get_skill_md"
  );

  for (const [name, fn] of entries) {
    const schema = fn.__schema__!;
    functionDocs.push(`### \`${name}\``);
    functionDocs.push("");
    functionDocs.push(schema.description);
    functionDocs.push("");

    const props = schema.parameters?.properties;
    const required = schema.parameters?.required ?? [];

    if (props && Object.keys(props).length > 0) {
      functionDocs.push("**Parameters:**");
      functionDocs.push("");
      functionDocs.push("| Parameter | Type | Required | Description |");
      functionDocs.push("|-----------|------|----------|-------------|");
      for (const [param, info] of Object.entries(props)) {
        const isRequired = required.includes(param);
        let typeStr = info.type ?? "any";
        if (info.enum) {
          // Use HTML-escaped "or" separator; "|" breaks Markdown tables.
          typeStr = info.enum.map((e) => `"${e}"`).join(" / ");
        }
        if (info.items) typeStr = `${info.items.type}[]`;
        // Escape pipes in descriptions to avoid breaking table layout
        const desc = (info.description ?? "").replace(/\|/g, "\\|");
        functionDocs.push(
          `| \`${param}\` | ${typeStr} | ${isRequired ? "Yes" : "No"} | ${desc} |`
        );
      }
      functionDocs.push("");

      // Example curl
      if (required.length > 0) {
        const exampleParams: Record<string, string> = {};
        for (const p of required) {
          const info = props[p];
          if (info?.type === "string") exampleParams[p] = `<${p}>`;
          else if (info?.type === "number") exampleParams[p] = "0" as any;
          else exampleParams[p] = `<${p}>` as any;
        }
        functionDocs.push("**Example:**");
        functionDocs.push("```bash");
        functionDocs.push(
          `curl -X POST '{SERVICE_URL}/${name}' \\`
        );
        functionDocs.push(`  -H 'Content-Type: application/json' \\`);
        functionDocs.push(`  -d '${JSON.stringify(exampleParams)}'`);
        functionDocs.push("```");
      } else {
        functionDocs.push("**Example:**");
        functionDocs.push("```bash");
        functionDocs.push(
          `curl '{SERVICE_URL}/${name}'`
        );
        functionDocs.push("```");
      }
    } else {
      functionDocs.push("**Parameters:** None");
      functionDocs.push("");
      functionDocs.push("**Example:**");
      functionDocs.push("```bash");
      functionDocs.push(
        `curl '{SERVICE_URL}/${name}'`
      );
      functionDocs.push("```");
    }
    functionDocs.push("");
  }

  const tips = [
    "## Tips",
    "",
    "- **`execute_script` is the most versatile** — use it for reading state, calling APIs, DOM queries, or anything not covered by other functions. The last expression is auto-returned. Returns `{result, type}`.",
    "- **`get_browser_state` is the best way to see what's on the page** — it detects all interactive elements and shows them as indexed items.",
    "- **After each action, call `get_browser_state` again** — element indices change when the DOM updates.",
    "- **Use `take_screenshot`** to visually verify the page state. The response includes `base64` (raw, ready for Claude/GPT image fields) and `data_url` (for HTML previews). Default size is 800px JPEG q=0.6 — bump `max_width` if you need more detail.",
    "- **Use `remove_highlights`** before a screenshot for a clean view.",
    "- **Use `scroll`** with an element index to scroll inside a specific container (e.g. a chat window, sidebar).",
    "- **Use `get_page_info` with `include_logs=true`** to check for JavaScript errors or debug output.",
    "- **Use `get_react_tree`** if the page uses React — it gives you component names, props, and state without needing DevTools.",
    "- **Use `navigate`** to go to other pages — same-origin navigation auto-reconnects the debugger.",
    "- **If you get `{success: false, detail: \"Service not found\"}`** — the browser tab was closed or the debugger disconnected. The user needs to re-click the bookmarklet.",
    "- **Append `?_mode=last`** to the URL if the service clientId changed (e.g. after page reload) — resolves to the most recent instance.",
    "- All POST endpoints accept JSON body with the parameter names as keys.",
    "",
  ].join("\n");

  return [frontmatter, intro, functionDocs.join("\n"), tips].join("\n");
}
