/**
 * Compute a stable, predictable Hypha service URL from a server URL and a
 * registered service id. Strips the clientId prefix so the URL uses only the
 * bare service name (callers append ?_mode=last to resolve the latest instance).
 *
 * Shared by the direct debugger path (debugger.ts) and the relay connector so
 * both compute identical URLs.
 */
export function buildServiceUrl(serverUrl: string, serviceId: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  const slashIdx = serviceId.indexOf("/");
  if (slashIdx !== -1) {
    const workspace = serviceId.substring(0, slashIdx);
    const svcPart = serviceId.substring(slashIdx + 1);
    // Strip clientId: "abc123:web-debugger" → "web-debugger"
    const colonIdx = svcPart.indexOf(":");
    const svcName = colonIdx !== -1 ? svcPart.substring(colonIdx + 1) : svcPart;
    return `${base}/${workspace}/services/${svcName}`;
  }
  return `${base}/services/${serviceId}`;
}

/** Cryptographically random hex string of `bytes` bytes. */
export function randomHex(bytes = 8): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
