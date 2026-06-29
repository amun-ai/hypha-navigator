/**
 * Wire protocol for the relay bridge between the in-page Agent (where the DOM
 * is) and the Connector (where Hypha is reachable: a popup window or an
 * extension offscreen document). All payloads are plain JSON.
 *
 * Handshake:
 *   Connector → Agent : connector-ready
 *   Agent     → Connector : hello (service catalog: names + schemas)
 *   Connector connects to Hypha, registers a proxy service, then:
 *   Connector → Agent : ready (service_url, token, workspace)
 * Per remote call:
 *   Connector → Agent : call (id, method, args)   [args already positional]
 *   Agent     → Connector : result (id, result) | error (id, error)
 */
export type RelayMsg =
  | { t: "connector-ready" }
  | { t: "hello"; services: Array<{ name: string; schema: any }>; meta: any }
  | { t: "ready"; service_url: string; token: string; workspace: string }
  | { t: "call"; id: string; method: string; args: any[] }
  | { t: "result"; id: string; result: any }
  | { t: "error"; id: string; error: string }
  | { t: "status"; status: string; detail?: string }
  | { t: "bye" };

/** Marker added to every postMessage payload so we ignore unrelated messages. */
export const RELAY_MARKER = "__hyphaRelay";
