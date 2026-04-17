/**
 * Lightweight in-memory debug log with pub/sub for the UI.
 * Mirrors entries to the browser console for parity.
 */

export type DebugLevel = "info" | "warn" | "error" | "debug";

export interface DebugEntry {
  id: number;
  ts: number;
  level: DebugLevel;
  scope: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;

let entries: DebugEntry[] = [];
let nextId = 1;
const listeners = new Set<(entries: DebugEntry[]) => void>();

function emit() {
  for (const l of listeners) l(entries);
}

export function log(
  level: DebugLevel,
  scope: string,
  message: string,
  data?: unknown,
) {
  const entry: DebugEntry = {
    id: nextId++,
    ts: Date.now(),
    level,
    scope,
    message,
    data,
  };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  emit();

  const prefix = `[${scope}]`;
  const fn =
    level === "error" ? console.error
    : level === "warn" ? console.warn
    : level === "debug" ? console.debug
    : console.log;
  if (data !== undefined) fn(prefix, message, data);
  else fn(prefix, message);
}

export const debugLog = {
  info: (scope: string, msg: string, data?: unknown) => log("info", scope, msg, data),
  warn: (scope: string, msg: string, data?: unknown) => log("warn", scope, msg, data),
  error: (scope: string, msg: string, data?: unknown) => log("error", scope, msg, data),
  debug: (scope: string, msg: string, data?: unknown) => log("debug", scope, msg, data),
};

export function subscribe(fn: (entries: DebugEntry[]) => void): () => void {
  listeners.add(fn);
  fn(entries);
  return () => {
    listeners.delete(fn);
  };
}

export function clearLog() {
  entries = [];
  emit();
}

export function getEntries(): DebugEntry[] {
  return entries;
}

export function formatEntries(list: DebugEntry[] = entries): string {
  return list
    .map((e) => {
      const t = new Date(e.ts).toISOString();
      const data = e.data !== undefined ? ` ${safeStringify(e.data)}` : "";
      return `${t} [${e.level.toUpperCase()}] [${e.scope}] ${e.message}${data}`;
    })
    .join("\n");
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
