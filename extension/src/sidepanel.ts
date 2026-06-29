/**
 * Side panel UI — one browser-wide connection: connect/disconnect, the service
 * URL to hand an agent, and a live activity log. State is driven by __ui
 * messages from the offscreen connection + the SW dispatcher.
 */
import { buildAgentInstruction } from "../../javascript/src/relay/instruction.js";

const $ = (id: string) => document.getElementById(id)!;
const dot = $("dot");
try {
  const v = "v" + chrome.runtime.getManifest().version;
  $("title").textContent = `Hypha Debugger ${v}`;
  document.title = `Hypha Debugger ${v}`;
} catch {
  /* ignore */
}
const serverInput = $("server") as HTMLInputElement;
const wsInput = $("workspace") as HTMLInputElement;
const tokenInput = $("token") as HTMLInputElement;
const requireToken = $("requireToken") as HTMLInputElement;
const connectBtn = $("connect") as HTMLButtonElement;
const disconnectBtn = $("disconnect") as HTMLButtonElement;
const urlBox = $("urlBox");
const urlCode = $("url");
const logsEl = $("logs");

let status = "disconnected";
let serviceUrl = "";

function render(): void {
  dot.className = "dot " + status;
  const connected = status === "connected";
  connectBtn.disabled = connected || status === "connecting";
  disconnectBtn.disabled = !connected && status !== "connecting";
  connectBtn.textContent = connected ? "Connected" : "Connect browser";
  urlBox.className = "url" + (serviceUrl ? " show" : "");
  urlCode.textContent = serviceUrl;
}

function appendLog(msg: string, kind: string): void {
  const div = document.createElement("div");
  div.className = "log " + kind;
  div.innerHTML = `<span class="t">${new Date().toLocaleTimeString()}</span> <span class="k">${escapeHtml(msg)}</span>`;
  logsEl.appendChild(div);
  while (logsEl.childElementCount > 400) logsEl.removeChild(logsEl.firstChild!);
  logsEl.scrollTop = logsEl.scrollHeight;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

let currentOrigin = "";
function setTarget(tab: { id: number; title?: string; url?: string }): void {
  const el = $("targetTab");
  const label = tab.title || tab.url || `tab ${tab.id}`;
  el.textContent = label;
  el.setAttribute("title", `${tab.title || ""}\n${tab.url || ""}`);
  let origin = "";
  try {
    if (tab.url) origin = new URL(tab.url).origin;
  } catch {
    /* non-http target */
  }
  if (origin !== currentOrigin) {
    currentOrigin = origin;
    void refreshSkillsInfo();
  }
}

chrome.runtime.onMessage.addListener((m: any) => {
  if (!m || !m.__ui) return;
  if (m.type === "log") {
    appendLog(m.msg, m.kind || "");
  } else if (m.type === "status") {
    status = m.status;
    if (m.status === "disconnected" || m.status === "error") serviceUrl = "";
    appendLog(`· ${m.status}${m.detail ? ": " + m.detail : ""}`, m.status === "error" ? "error" : "status");
    render();
  } else if (m.type === "ready") {
    status = "connected";
    serviceUrl = m.service_url;
    appendLog(`connected → ${m.service_url}`, "result");
    render();
  } else if (m.type === "target" && m.tab) {
    setTarget(m.tab);
  }
});

connectBtn.addEventListener("click", async () => {
  const config = {
    server_url: serverInput.value.trim() || "https://hypha.aicell.io",
    workspace: wsInput.value.trim(),
    token: tokenInput.value.trim(),
    require_token: requireToken.checked,
  };
  await chrome.storage.local.set({ hyphaServerUrl: config.server_url });
  status = "connecting";
  serviceUrl = "";
  render();
  chrome.runtime.sendMessage({ __ctl: "connect", config });
});
disconnectBtn.addEventListener("click", () => {
  status = "disconnected";
  serviceUrl = "";
  render();
  chrome.runtime.sendMessage({ __ctl: "disconnect" });
});
function flashCopied(btn: HTMLButtonElement): void {
  const orig = btn.textContent;
  btn.textContent = "Copied!";
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = orig;
    btn.disabled = false;
  }, 1400);
}
$("copyUrl").addEventListener("click", async () => {
  if (!serviceUrl) return;
  await navigator.clipboard.writeText(serviceUrl);
  flashCopied($("copyUrl") as HTMLButtonElement);
});
$("copySkill").addEventListener("click", async () => {
  if (!serviceUrl) return;
  await navigator.clipboard.writeText(
    buildAgentInstruction(serviceUrl, {
      subject: "a web browser (open/close/switch tabs + inspect & control pages)",
    }),
  );
  flashCopied($("copySkill") as HTMLButtonElement);
});
$("clear").addEventListener("click", () => {
  logsEl.innerHTML = "";
});
$("pinTab").addEventListener("click", () => {
  chrome.runtime.sendMessage({ __ctl: "pinActiveTab" });
});
$("focusTab").addEventListener("click", () => {
  chrome.runtime.sendMessage({ __ctl: "focusTarget" });
});

// ---- skills: show count + export/import as JSON --------------------------
const SKILLS_KEY = "hyphaSiteSkills";
async function refreshSkillsInfo(): Promise<void> {
  const all = (await chrome.storage.local.get(SKILLS_KEY))[SKILLS_KEY] || {};
  const sites = Object.keys(all).length;
  const entries = Object.values(all).reduce(
    (n: number, e: any) => n + Object.keys(e || {}).length,
    0,
  );
  const here = currentOrigin ? Object.keys(all[currentOrigin] || {}).length : 0;
  const total = `${entries} across ${sites} site${sites === 1 ? "" : "s"}`;
  $("skillsInfo").textContent = currentOrigin
    ? `Site skills: ${here} for this site · ${total}`
    : `Site skills: ${total}`;
}
$("exportSkills").addEventListener("click", async () => {
  const all = (await chrome.storage.local.get(SKILLS_KEY))[SKILLS_KEY] || {};
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hypha-site-skills.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  appendLog("exported site skills", "status");
});
$("importSkills").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (typeof imported !== "object" || Array.isArray(imported) || imported === null)
        throw new Error("not a skills object");
      const cur = (await chrome.storage.local.get(SKILLS_KEY))[SKILLS_KEY] || {};
      let merged = 0;
      for (const [site, entries] of Object.entries(imported as Record<string, any>)) {
        if (!entries || typeof entries !== "object") continue;
        cur[site] = { ...(cur[site] || {}), ...entries };
        merged += Object.keys(entries).length;
      }
      await chrome.storage.local.set({ [SKILLS_KEY]: cur });
      await refreshSkillsInfo();
      appendLog(`imported ${merged} site-skill entr${merged === 1 ? "y" : "ies"}`, "result");
    } catch (e: any) {
      appendLog("import failed: " + (e?.message ?? e), "error");
    }
  };
  input.click();
});
chrome.storage.onChanged?.addListener?.((changes: any, area: string) => {
  if (area === "local" && changes[SKILLS_KEY]) void refreshSkillsInfo();
});
// Save the server URL as the user edits it (persists across sessions, even
// without connecting).
let saveTimer: any;
serverInput.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ hyphaServerUrl: serverInput.value.trim() });
  }, 300);
});

(async () => {
  // Restore the live connection state from storage so re-opening the panel
  // shows the URL/status without a disconnect/reconnect.
  const r = await chrome.storage.local.get([
    "hyphaServerUrl",
    "hyphaStatus",
    "hyphaServiceUrl",
  ]);
  if (r.hyphaServerUrl) serverInput.value = r.hyphaServerUrl;
  if (r.hyphaStatus) status = r.hyphaStatus;
  if (r.hyphaServiceUrl) serviceUrl = r.hyphaServiceUrl;
  render();
  void refreshSkillsInfo();
  // Ask the SW to replay the current target tab.
  chrome.runtime.sendMessage({ __ctl: "getStatus" }).catch(() => {});
})();
