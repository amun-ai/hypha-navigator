/**
 * One concise, human-facing instruction to paste into an AI agent. It gives a
 * single URL — the get_skill_md endpoint — and nothing else; the skill document
 * itself contains the base service URL, every tool, and usage examples. Shared
 * by the overlay, the console log, and the extension side panel.
 */
export function buildAgentInstruction(
  serviceUrl: string,
  opts: { token?: string; target?: string; subject?: string } = {},
): string {
  const subject =
    opts.subject ??
    (opts.target ? `a live web page ("${opts.target}")` : "a live web page");
  const auth = opts.token
    ? ` Authenticate with header: Authorization: Bearer ${opts.token}.`
    : "";
  return (
    `A Hypha debugger is attached to ${subject} and is controllable over HTTP. ` +
    `Read its full API, tools, and usage at ${serviceUrl}/get_skill_md — start there.${auth}`
  );
}
