import { ConnectionStatus } from "@/hooks/useWebRTC";

interface StatusIndicatorProps {
  status: ConnectionStatus;
  label: string;
}

const statusConfig: Record<ConnectionStatus, { className: string; text: string }> = {
  connected: { className: "bg-status-online animate-pulse-dot", text: "LIVE" },
  connecting: { className: "bg-status-connecting animate-pulse-dot", text: "CONNECTING" },
  disconnected: { className: "bg-muted-foreground", text: "OFFLINE" },
  error: { className: "bg-status-offline", text: "ERROR" },
};

export function StatusIndicator({ status, label }: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2 font-mono text-xs tracking-wider">
      <span className={`h-2 w-2 rounded-full ${config.className}`} />
      <span className="text-muted-foreground uppercase">{label}</span>
      <span className="text-foreground">{config.text}</span>
    </div>
  );
}
