import { useState } from "react";
import { Shield } from "lucide-react";
import { useWebRTC } from "@/hooks/useWebRTC";
import { VideoFeed } from "@/components/VideoFeed";
import { IntercomControls } from "@/components/IntercomControls";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { SettingsPanel, loadConfig, type JanusConfig } from "@/components/SettingsPanel";

const Index = () => {
  const [config, setConfig] = useState<JanusConfig>(() => loadConfig());

  const {
    videoRef,
    videoStatus,
    audioStatus,
    signalingStatus,
    isMuted,
    error,
    connectVideo,
    connectAudio,
    disconnectAudio,
    toggleMute,
  } = useWebRTC({
    // Remount the hook when config changes so the new URL/room take effect cleanly
    key: `${config.signalingUrl}|${config.videoroomRoom}`,
    signalingUrl: config.signalingUrl,
    videoroomRoom: config.videoroomRoom,
    autoConnect: true,
  } as never);

  return (
    <div className="min-h-screen flex flex-col" key={`${config.signalingUrl}|${config.videoroomRoom}`}>
      {/* Header */}
      <header className="glass-surface border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="font-mono text-sm font-semibold tracking-wider text-foreground uppercase">
            SecureView
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs text-muted-foreground">CAM-01</div>
          <SettingsPanel config={config} onSave={setConfig} />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 flex flex-col gap-4 max-w-5xl mx-auto w-full">
        <VideoFeed videoRef={videoRef} status={videoStatus} />
        <IntercomControls
          audioStatus={audioStatus}
          isMuted={isMuted}
          onConnect={connectAudio}
          onDisconnect={disconnectAudio}
          onToggleMute={toggleMute}
        />
        <ConnectionPanel
          videoStatus={videoStatus}
          audioStatus={audioStatus}
          signalingStatus={signalingStatus}
          error={error}
          onReconnect={connectVideo}
        />
      </main>
    </div>
  );
};

export default Index;
