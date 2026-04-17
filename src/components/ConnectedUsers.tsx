import { Users } from "lucide-react";
import { useMemo } from "react";

export const ConnectedUsers = () => {
  const users = useMemo(() => {
    if (typeof window === "undefined") return [];
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("user");
    if (!raw) return [];
    return raw
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
  }, []);

  return (
    <section className="glass-surface rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-primary" />
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
          Connected Users
        </h2>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {users.length}
        </span>
      </div>
      {users.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          No users connected. Append <code className="text-primary">?user=name1,name2</code> to the URL.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {users.map((name) => (
            <li
              key={name}
              className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-1.5"
            >
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-xs text-foreground">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
