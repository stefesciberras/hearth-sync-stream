import { Settings, RefreshCw } from "lucide-react";
import { ConnectionStatus } from "@/hooks/useWebRTC";
import type { JanusConnectionState } from "@/lib/janus";
import { StatusIndicator } from "./StatusIndicator";
import { Button } from "@/components/ui/button";

interface ConnectionPanelProps {
  videoStatus: ConnectionStatus;
  audioStatus: ConnectionStatus;
  signalingStatus?: JanusConnectionState;
  error: string | null;
  onReconnect: () => void;
}

export function ConnectionPanel({
  videoStatus,
  audioStatus,
  signalingStatus,
  error,
  onReconnect,
}: ConnectionPanelProps) {
  const signalingAsConnection: ConnectionStatus =
    signalingStatus === "connected" ? "connected"
    : signalingStatus === "reconnecting" ? "connecting"
    : "disconnected";

  return (
    <div className="glass-surface rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Connection Status
        </h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onReconnect}
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <StatusIndicator status={signalingAsConnection} label="Signaling" />
        <StatusIndicator status={videoStatus} label="Video" />
        <StatusIndicator status={audioStatus} label="Audio" />
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          <p className="font-mono text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}