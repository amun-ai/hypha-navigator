/**
 * RelayConnector — runs in the realm that can reach Hypha (a popup window on a
 * permissive origin, or an extension offscreen document). It owns the Hypha
 * WebSocket connection and registers a debug service whose functions are
 * PROXIES: each call is relayed over the channel to the in-page Agent (which
 * has the DOM) and its result returned over RPC.
 *
 * This is what gets the connection out of the page's `connect-src` CSP realm.
 */
import type { Channel } from "./channel.js";
import type { RelayMsg } from "./protocol.js";
import { buildServiceUrl, randomHex } from "./service-url.js";
import { wrapFn as baseWrapFn } from "../utils/wrap-fn.js";

export interface RelayConnectorConfig {
  server_url: string;
  workspace?: string;
  token?: string;
  service_id?: string;
  service_name?: string;
  visibility?: "public" | "protected" | "unlisted";
  require_token?: boolean;
  /** connectToServer from hypha-rpc. */
  connect: (cfg: any) => Promise<any>;
}

export interface RelayConnectorOptions {
  onStatus?: (status: string, detail?: string) => void;
  /** Per-call timeout in ms (default 60s). */
  callTimeoutMs?: number;
}

export class RelayConnector {
  private server: any = null;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: any) => void; timer: any }
  >();
  private unsub: (() => void) | null = null;

  constructor(
    private channel: Channel,
    private cfg: RelayConnectorConfig,
    private opts: RelayConnectorOptions = {},
  ) {}

  start(): void {
    this.unsub = this.channel.onMessage((msg) => this.handle(msg));
    this.channel.post({ t: "connector-ready" });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("connector stopped"));
    }
    this.pending.clear();
  }

  private handle(msg: RelayMsg): void {
    switch (msg.t) {
      case "hello":
        void this.onHello(msg);
        break;
      case "result":
        this.settle(msg.id, undefined, msg.result);
        break;
      case "error":
        this.settle(msg.id, msg.error);
        break;
    }
  }

  private async onHello(
    msg: Extract<RelayMsg, { t: "hello" }>,
  ): Promise<void> {
    try {
      this.opts.onStatus?.("connecting");
      const connectConfig: any = { server_url: this.cfg.server_url };
      if (this.cfg.workspace) connectConfig.workspace = this.cfg.workspace;
      if (this.cfg.token) connectConfig.token = this.cfg.token;

      try {
        this.server = await this.cfg.connect(connectConfig);
      } catch (e: any) {
        if (this.cfg.workspace) {
          this.server = await this.cfg.connect({
            server_url: this.cfg.server_url,
          });
        } else {
          throw e;
        }
      }

      const requireToken = this.cfg.require_token ?? false;
      const visibility =
        this.cfg.visibility ?? (requireToken ? "protected" : "unlisted");
      const serviceId =
        this.cfg.service_id ?? `web-debugger-${randomHex(16)}`;

      const def: any = {
        id: serviceId,
        name: this.cfg.service_name ?? msg.meta?.name ?? "Web Debugger",
        type: msg.meta?.type ?? "debugger",
        description: msg.meta?.description ?? "Remote web page debugger.",
        config: { visibility },
      };
      for (const { name, schema } of msg.services) {
        def[name] = this.makeProxy(name, schema);
      }

      const info = await this.server.registerService(def);
      const serviceUrl = buildServiceUrl(
        this.cfg.server_url,
        info.id ?? serviceId,
      );
      const workspace = this.server.config?.workspace ?? "";
      const token = requireToken
        ? await this.server.generateToken({ expires_in: 86400 })
        : "";

      this.channel.post({ t: "ready", service_url: serviceUrl, token, workspace });
      this.opts.onStatus?.("connected", serviceUrl);
    } catch (err: any) {
      this.opts.onStatus?.("error", err?.message ?? String(err));
      this.channel.post({
        t: "status",
        status: "error",
        detail: err?.message ?? String(err),
      });
    }
  }

  /**
   * Build a proxy function for one service method. Wrapped with baseWrapFn so it
   * carries the schema + the toString() param-name trick — this is what keeps
   * HTTP kwargs ({code: "..."}) mapping to positional args correctly. baseWrapFn
   * converts kwargs→positional BEFORE we relay, so the Agent calls the raw
   * service fn with plain positional args.
   */
  private makeProxy(name: string, schema: any): any {
    const inner = async (...args: any[]) => this.relayCall(name, args);
    (inner as any).__schema__ = schema;
    return baseWrapFn(inner);
  }

  private relayCall(method: string, args: any[]): Promise<any> {
    const id = randomHex(8);
    const timeoutMs = this.opts.callTimeoutMs ?? 60000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`relay call "${method}" timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.channel.post({ t: "call", id, method, args });
    });
  }

  private settle(id: string, error?: string, result?: any): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  }
}
