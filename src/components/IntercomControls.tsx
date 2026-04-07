import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { ConnectionStatus } from "@/hooks/useWebRTC";
import { Button } from "@/components/ui/button";

interface IntercomControlsProps {
  audioStatus: ConnectionStatus;
  isMuted: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
}

export function IntercomControls({
  audioStatus,
  isMuted,
  onConnect,
  onDisconnect,
  onToggleMute,
}: IntercomControlsProps) {
  const isAudioConnected = audioStatus === "connected";
  const isConnecting = audioStatus === "connecting";

  return (
    <div className="glass-surface rounded-lg p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-mono text-xs tracking-wider">
          <span
            className={`h-2 w-2 rounded-full ${
              isAudioConnected
                ? "bg-status-online animate-pulse-dot"
                : isConnecting
                ? "bg-status-connecting animate-pulse-dot"
                : "bg-muted-foreground"
            }`}
          />
          <span className="text-muted-foreground">INTERCOM</span>
          <span className="text-foreground">
            {isAudioConnected ? "ACTIVE" : isConnecting ? "CONNECTING" : "STANDBY"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isAudioConnected && (
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleMute}
            className={`h-10 w-10 rounded-full border-border ${
              isMuted ? "" : "glow-green border-primary"
            }`}
          >
            {isMuted ? (
              <MicOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Mic className="h-4 w-4 text-primary" />
            )}
          </Button>
        )}

        <Button
          variant={isAudioConnected ? "destructive" : "default"}
          size="icon"
          onClick={isAudioConnected ? onDisconnect : onConnect}
          disabled={isConnecting}
          className={`h-10 w-10 rounded-full ${
            isAudioConnected ? "glow-red" : "glow-green"
          }`}
        >
          {isAudioConnected ? (
            <PhoneOff className="h-4 w-4" />
          ) : (
            <Phone className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
