/**
 * Transport abstraction for the relay bridge. The Agent and Connector are
 * written against this interface so the same logic runs over postMessage
 * (popup relay) or chrome.runtime messaging (extension — implemented in the
 * extension package, which has the chrome.* types).
 */
import { RELAY_MARKER, type RelayMsg } from "./protocol.js";

export interface Channel {
  post(msg: RelayMsg): void;
  /** Subscribe to incoming messages. Returns an unsubscribe function. */
  onMessage(cb: (msg: RelayMsg) => void): () => void;
}

/**
 * postMessage channel between two windows (popup relay).
 *
 * Security: every message carries a 128-bit `nonce` (shared via the connector
 * URL hash, known only to the two peers) and is validated against it. Incoming
 * messages are also checked against the expected peer `origin`. Outgoing
 * messages are posted with an explicit `targetOrigin` (never "*").
 */
export class PostMessageChannel implements Channel {
  constructor(
    private target: Window,
    private targetOrigin: string,
    private nonce: string,
    private acceptOrigin: string,
  ) {}

  post(msg: RelayMsg): void {
    try {
      this.target.postMessage(
        { ...(msg as any), [RELAY_MARKER]: true, nonce: this.nonce },
        this.targetOrigin,
      );
    } catch {
      // target may be closed
    }
  }

  onMessage(cb: (msg: RelayMsg) => void): () => void {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d[RELAY_MARKER] !== true || d.nonce !== this.nonce) return;
      if (this.acceptOrigin !== "*" && e.origin !== this.acceptOrigin) return;
      cb(d as RelayMsg);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }

  /** Update the target window (e.g. once the popup reference is available). */
  setTarget(target: Window): void {
    this.target = target;
  }
}
