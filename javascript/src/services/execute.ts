/**
 * Arbitrary JavaScript execution service.
 */

/**
 * Detect the EvalError thrown when a page's Content Security Policy blocks the
 * Function constructor / eval (no 'unsafe-eval'). Chrome throws an EvalError
 * whose message mentions "unsafe-eval" / "Content Security Policy".
 */
function isCspEvalError(e: any): boolean {
  if (!e) return false;
  if (e instanceof EvalError) return true;
  const msg = String(e.message || e);
  return /unsafe-eval|Content Security Policy|call to .*Function/i.test(msg);
}

/**
 * Attempt to auto-return the last expression in a code block.
 * If the code doesn't contain an explicit `return`, we try to
 * add one to the last expression statement so the result is captured.
 *
 * Examples:
 *   "document.title"            → "return (document.title);"
 *   "const x = 1; x + 2"       → "const x = 1; return (x + 2);"
 *   "const x = 1\nx + 2"       → "const x = 1\nreturn (x + 2);"
 *   "for(...) {}"               → unchanged (control flow)
 *   "return 42"                 → unchanged (explicit return)
 */
export function autoReturn(code: string): string {
  const trimmed = code.trim();
  // Already has a return statement? Leave it alone.
  if (/\breturn\b/.test(trimmed)) return trimmed;

  // Split into statements: by newlines first, then by semicolons for
  // single-line multi-statement code like "const x = 1; x + 2"
  let lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);

  // If there's only one line with semicolons, split on semicolons
  if (lines.length === 1 && lines[0].includes(";")) {
    lines = lines[0].split(";").map((s) => s.trim()).filter(Boolean);
  }

  if (lines.length === 0) return trimmed;
  const lastLine = lines[lines.length - 1];

  // Don't add return to control flow, declarations, or assignment-only statements
  if (/^(if|for|while|switch|try|class|function |const |let |var |import |export )/.test(lastLine)) {
    return trimmed;
  }

  // Replace last statement with return
  lines[lines.length - 1] = "return (" + lastLine.replace(/;$/, "") + ");";
  return lines.join(";\n");
}

export async function executeScript(
  code: string,
  timeout_ms?: number,
): Promise<{ result: any; type: string } | { error: string }> {
  const timeoutMs = timeout_ms ?? 10000;

  try {
    // Try with auto-return first, fall back to original code if syntax error.
    // NOTE: running arbitrary code fundamentally requires the Function
    // constructor, which strict CSP (no 'unsafe-eval') blocks. There is no
    // CSP-safe alternative for execute_script — detect that and report clearly.
    let execCode = autoReturn(code);
    let fn: Function;
    try {
      fn = new Function("return (async () => {" + execCode + "})()");
    } catch (e: any) {
      if (isCspEvalError(e)) {
        return {
          error:
            "execute_script is unavailable on this page: its Content Security " +
            "Policy blocks dynamic code evaluation ('unsafe-eval' not allowed). " +
            "Use the DOM/interaction services (get_browser_state, click_element_by_index, " +
            "query_dom, etc.) instead — they do not need eval.",
        };
      }
      // Auto-return broke the syntax — use original code
      fn = new Function("return (async () => {" + code + "})()");
    }

    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Execution timed out")), timeoutMs)
      ),
    ]);

    // Serialize the result safely
    let serialized: any;
    let type: string = typeof result;
    try {
      if (result === undefined) {
        serialized = null;
        type = "undefined";
      } else if (result instanceof HTMLElement) {
        serialized = {
          tag: result.tagName.toLowerCase(),
          id: result.id,
          className: result.className,
          text: (result.textContent ?? "").trim().slice(0, 500),
        };
        type = "HTMLElement";
      } else if (result instanceof NodeList || result instanceof HTMLCollection) {
        serialized = Array.from(result).map((el: any) => ({
          tag: el.tagName?.toLowerCase(),
          id: el.id,
          text: (el.textContent ?? "").trim().slice(0, 200),
        }));
        type = "NodeList";
      } else {
        // Try JSON serialization, fall back to string
        serialized = JSON.parse(JSON.stringify(result));
      }
    } catch {
      serialized = String(result);
      type = "string (serialized)";
    }

    return { result: serialized, type };
  } catch (err: any) {
    return { error: `Execution error: ${err.message ?? err}` };
  }
}

executeScript.__schema__ = {
  name: "executeScript",
  description:
    'Execute arbitrary JavaScript code in the page context. Supports async/await. ' +
    'The last expression is auto-returned (no need for explicit "return"). ' +
    'Examples: "document.title", "document.querySelectorAll(\'a\').length", ' +
    '"await fetch(\'/api/data\').then(r => r.json())". ' +
    'Returns: { result, type } on success, or { error } on exception.',
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          'JavaScript code to execute. The last expression is automatically returned. Examples: "document.title", "document.querySelector(\'h1\').textContent".',
      },
      timeout_ms: {
        type: "number",
        description: "Maximum execution time in milliseconds. Default: 10000.",
      },
    },
    required: ["code"],
  },
};
