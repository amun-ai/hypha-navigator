/**
 * RelayAgent — runs in the realm that has the DOM (the debugged page). It holds
 * the real service functions and answers `call` messages from the Connector,
 * which owns the Hypha connection in a different realm (popup / offscreen doc).
 *
 * The Agent never touches the network, so it is unaffected by the page's
 * `connect-src` CSP.
 */
import type { Channel } from "./channel.js";
import type { RelayMsg } from "./protocol.js";
import {
  createServiceMap,
  SERVICE_META,
  type ServiceEntry,
} from "./service-map.js";

export interface RelayAgentOptions {
  onLog?: (msg: string, kind: "call" | "result" | "error") => void;
  onReady?: (info: {
    service_url: string;
    token: string;
    workspace: string;
  }) => void;
  onStatus?: (status: string, detail?: string) => void;
  /**
   * Optional override for get_react_tree. Needed in the extension, where the
   * isolated-world agent cannot read React fiber expandos and must delegate to
   * a MAIN-world helper. Undefined in the popup relay (runs in MAIN world).
   */
  reactBridge?: (selector?: string, depth?: number) => Promise<any>;
}

export class RelayAgent {
  private serviceUrl = "{SERVICE_URL}";
  private serviceMap: ServiceEntry[];
  private unsub: (() => void) | null = null;

  constructor(
    private channel: Channel,
    private opts: RelayAgentOptions = {},
  ) {
    this.serviceMap = createServiceMap({ getServiceUrl: () => this.serviceUrl });
  }

  start(): void {
    this.unsub = this.channel.onMessage((msg) => this.handle(msg));
    // The connector may already be loaded and have sent connector-ready before
    // we subscribed; also proactively offer the catalog. Harmless if duplicated.
    this.sendHello();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private handle(msg: RelayMsg): void {
    switch (msg.t) {
      case "connector-ready":
        this.sendHello();
        break;
      case "ready":
        this.serviceUrl = msg.service_url;
        this.opts.onReady?.(msg);
        this.opts.onStatus?.("connected");
        break;
      case "call":
        void this.dispatch(msg);
        break;
      case "status":
        this.opts.onStatus?.(msg.status, msg.detail);
        break;
    }
  }

  private sendHello(): void {
    const services = this.serviceMap.map((e) => ({
      name: e.name,
      schema: e.schema,
    }));
    this.channel.post({ t: "hello", services, meta: SERVICE_META });
  }

  private async dispatch(msg: Extract<RelayMsg, { t: "call" }>): Promise<void> {
    const entry = this.serviceMap.find((e) => e.name === msg.method);
    if (!entry) {
      this.channel.post({
        t: "error",
        id: msg.id,
        error: `Unknown method: ${msg.method}`,
      });
      return;
    }
    this.opts.onLog?.(`${msg.method}(${summarize(msg.args)})`, "call");
    try {
      const args = msg.args ?? [];
      let result: any;
      if (msg.method === "get_react_tree" && this.opts.reactBridge) {
        result = await this.opts.reactBridge(args[0], args[1]);
      } else {
        result = await entry.fn(...args);
      }
      const hasError = result && typeof result === "object" && "error" in result;
      this.opts.onLog?.(
        hasError ? `${msg.method}: ${result.error}` : `${msg.method} -> OK`,
        hasError ? "error" : "result",
      );
      this.channel.post({ t: "result", id: msg.id, result });
    } catch (err: any) {
      this.opts.onLog?.(`${msg.method}: ${err?.message ?? err}`, "error");
      this.channel.post({
        t: "error",
        id: msg.id,
        error: err?.message ?? String(err),
      });
    }
  }
}

function summarize(args: any[]): string {
  if (!args || args.length === 0) return "";
  return args
    .map((a) => {
      if (typeof a === "string")
        return a.length > 40 ? a.slice(0, 40) + "..." : a;
      if (typeof a === "object" && a !== null) return "{...}";
      return String(a);
    })
    .join(", ");
}
