import { RefObject } from "react";
import { ConnectionStatus } from "@/hooks/useWebRTC";
import { Video, VideoOff } from "lucide-react";

interface VideoFeedProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: ConnectionStatus;
}

export function VideoFeed({ videoRef, status }: VideoFeedProps) {
  const isConnected = status === "connected";

  return (
    <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border bg-card">
      {/* Scanline overlay */}
      <div className="absolute inset-0 scanline pointer-events-none z-10" />

      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover ${isConnected ? "opacity-100" : "opacity-0"}`}
      />

      {/* Placeholder when not connected */}
      {!isConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          {status === "connecting" ? (
            <>
              <Video className="h-12 w-12 text-status-connecting animate-pulse-dot" />
              <span className="font-mono text-sm text-status-connecting">
                Establishing connection...
              </span>
            </>
          ) : status === "error" ? (
            <>
              <VideoOff className="h-12 w-12 text-status-offline" />
              <span className="font-mono text-sm text-status-offline">
                Connection failed
              </span>
            </>
          ) : (
            <>
              <VideoOff className="h-12 w-12 text-muted-foreground" />
              <span className="font-mono text-sm text-muted-foreground">
                No signal
              </span>
            </>
          )}
        </div>
      )}

      {/* Timestamp overlay */}
      {isConnected && (
        <div className="absolute bottom-3 left-3 z-20">
          <TimestampOverlay />
        </div>
      )}

      {/* Live badge */}
      {isConnected && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 glass-surface rounded px-2 py-1">
          <span className="h-2 w-2 rounded-full bg-status-online animate-pulse-dot" />
          <span className="font-mono text-xs text-status-online font-semibold tracking-wider">
            LIVE
          </span>
        </div>
      )}
    </div>
  );
}

function TimestampOverlay() {
  // Update every second
  const now = new Date();
  const timestamp = now.toLocaleTimeString("en-US", { hour12: false });
  const date = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    <div className="glass-surface rounded px-2 py-1 font-mono text-xs text-muted-foreground">
      {date} {timestamp}
    </div>
  );
}
