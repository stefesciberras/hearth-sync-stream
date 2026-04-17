import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, Copy, Download, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  subscribe,
  clearLog,
  formatEntries,
  type DebugEntry,
  type DebugLevel,
} from "@/lib/debugLog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<DebugLevel, string> = {
  info: "text-foreground",
  debug: "text-muted-foreground",
  warn: "text-yellow-400",
  error: "text-destructive",
};

const LEVEL_BADGE: Record<DebugLevel, string> = {
  info: "bg-primary/10 text-primary",
  debug: "bg-muted text-muted-foreground",
  warn: "bg-yellow-500/15 text-yellow-400",
  error: "bg-destructive/15 text-destructive",
};

export function DebugPanel() {
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<"all" | DebugLevel>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribe(setEntries), []);

  const filtered = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.level === filter)),
    [entries, filter],
  );

  useEffect(() => {
    if (open && autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, open, autoScroll]);

  const errorCount = entries.filter((e) => e.level === "error").length;
  const warnCount = entries.filter((e) => e.level === "warn").length;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatEntries(filtered));
    toast.success("Debug log copied");
  };

  const handleDownload = () => {
    const blob = new Blob([formatEntries(filtered)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `secureview-debug-${new Date().toISOString()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-surface rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Bug className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Debug Log
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            ({entries.length})
          </span>
          {errorCount > 0 && (
            <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", LEVEL_BADGE.error)}>
              {errorCount} err
            </span>
          )}
          {warnCount > 0 && (
            <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", LEVEL_BADGE.warn)}>
              {warnCount} warn
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {(["all", "error", "warn", "info", "debug"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setFilter(lvl)}
                  className={cn(
                    "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    filter === lvl
                      ? "bg-primary/20 text-primary"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1">
              <label className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="h-3 w-3"
                />
                auto-scroll
              </label>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} title="Copy">
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="Download">
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => clearLog()}
                title="Clear"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="h-64 overflow-auto rounded border border-border bg-background/40 p-2 font-mono text-[11px] leading-relaxed"
          >
            {filtered.length === 0 ? (
              <p className="text-muted-foreground">No log entries.</p>
            ) : (
              filtered.map((e) => (
                <div key={e.id} className={cn("flex gap-2", LEVEL_STYLES[e.level])}>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                  <span className={cn("shrink-0 rounded px-1 text-[10px] uppercase", LEVEL_BADGE[e.level])}>
                    {e.level}
                  </span>
                  <span className="text-muted-foreground shrink-0">[{e.scope}]</span>
                  <span className="break-all">
                    {e.message}
                    {e.data !== undefined && (
                      <span className="text-muted-foreground"> {safeStringify(e.data)}</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
