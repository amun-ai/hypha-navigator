/**
 * Page information service.
 */
import { collectPageInfo, type PageInfo } from "../utils/env.js";

export function getPageInfo(
  include_logs?: boolean,
  log_limit?: number,
  log_level?: string,
): any {
  const info: any = collectPageInfo();

  if (include_logs) {
    const logs = (window as any).__HYPHA_DEBUGGER__?.consoleLogs ?? [];
    const limit = log_limit ?? 50;
    let filtered = log_level ? logs.filter((l: any) => l.level === log_level) : logs;
    info.console_logs = filtered.slice(-limit);
  }

  return info;
}

getPageInfo.__schema__ = {
  name: "getPageInfo",
  description:
    "Get information about the current web page including URL, title, viewport size, detected frameworks, and performance timing. Optionally include recent console logs.",
  parameters: {
    type: "object",
    properties: {
      include_logs: {
        type: "boolean",
        description: "If true, include recent console output in the response. Default: false.",
      },
      log_limit: {
        type: "number",
        description: "Maximum number of console log entries to include (most recent). Default: 50.",
      },
      log_level: {
        type: "string",
        description: 'Filter console logs by level: "log", "warn", "error", "info". Omit for all levels.',
        enum: ["log", "warn", "error", "info"],
      },
    },
  },
};

export function getConsoleLogs(options?: {
  level?: string;
  limit?: number;
}): Array<{ level: string; message: string; timestamp: string }> {
  const logs = (window as any).__HYPHA_DEBUGGER__?.consoleLogs ?? [];
  const level = options?.level;
  const limit = options?.limit ?? 100;
  let filtered = level ? logs.filter((l: any) => l.level === level) : logs;
  return filtered.slice(-limit);
}

getConsoleLogs.__schema__ = {
  name: "getConsoleLogs",
  description: "Retrieve captured console output (log, warn, error, info).",
  parameters: {
    type: "object",
    properties: {
      level: {
        type: "string",
        description:
          'Filter by log level: "log", "warn", "error", "info". Omit for all levels.',
        enum: ["log", "warn", "error", "info"],
      },
      limit: {
        type: "number",
        description:
          "Maximum number of log entries to return (most recent). Default: 100.",
      },
    },
  },
};

/** Install console interceptor to capture logs. */
export function installConsoleCapture(maxEntries = 500): void {
  const store = ((window as any).__HYPHA_DEBUGGER__ ??= {});
  if (store.consoleInstalled) return;

  store.consoleLogs = [] as Array<{
    level: string;
    message: string;
    timestamp: string;
  }>;
  store.consoleInstalled = true;

  const levels = ["log", "warn", "error", "info"] as const;
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: any[]) => {
      const logs = store.consoleLogs;
      logs.push({
        level,
        message: args
          .map((a: any) => {
            try {
              return typeof a === "string" ? a : JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" "),
        timestamp: new Date().toISOString(),
      });
      if (logs.length > maxEntries) {
        logs.splice(0, logs.length - maxEntries);
      }
      original(...args);
    };
  }
}
