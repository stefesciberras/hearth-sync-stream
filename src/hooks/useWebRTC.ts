import { useState, useRef, useCallback, useEffect } from "react";
import { JanusSession } from "@/lib/janus";
import type { JanusMessage, JanusConnectionState } from "@/lib/janus";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebRTCOptions {
  signalingUrl: string;
  videoroomRoom?: number;
  audiobridgeRoom?: number;
  autoConnect?: boolean;
}

export function useWebRTC({
  signalingUrl,
  videoroomRoom = 1234,
  audiobridgeRoom = 1234,
  autoConnect = true,
}: UseWebRTCOptions) {
  const [videoStatus, setVideoStatus] = useState<ConnectionStatus>("disconnected");
  const [audioStatus, setAudioStatus] = useState<ConnectionStatus>("disconnected");
  const [signalingStatus, setSignalingStatus] = useState<JanusConnectionState>("disconnected");
  const [isMuted, setIsMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const janusRef = useRef<JanusSession | null>(null);
  const videoPcRef = useRef<RTCPeerConnection | null>(null);
  const videoHandleRef = useRef<number | null>(null);
  const audioPcRef = useRef<RTCPeerConnection | null>(null);
  const audioHandleRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wasAudioConnectedRef = useRef(false);
  const destroyedRef = useRef(false);

  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
  ];

  // ── Helpers ─────────────────────────────────────

  const ensureSession = useCallback(async (): Promise<JanusSession> => {
    if (janusRef.current?.connected) return janusRef.current;
    const session = new JanusSession(signalingUrl);

    session.onConnectionStateChange = (state) => {
      setSignalingStatus(state);
      if (state === "reconnecting") {
        setError("Signaling connection lost — reconnecting…");
      }
    };

    session.onReconnected = () => {
      console.log("[WebRTC] Janus reconnected — re-establishing media");
      setError(null);
      // Re-attach video
      reattachVideo();
      // Re-attach audio if it was active before disconnect
      if (wasAudioConnectedRef.current) {
        reattachAudio();
      }
    };

    await session.connect();
    janusRef.current = session;
    return session;
  }, [signalingUrl]);

  const watchIceState = useCallback(
    (
      pc: RTCPeerConnection,
      setStatus: (s: ConnectionStatus) => void,
      label: string,
      onFailed?: () => void
    ) => {
      pc.oniceconnectionstatechange = () => {
        switch (pc.iceConnectionState) {
          case "connected":
          case "completed":
            setStatus("connected");
            break;
          case "failed":
            setStatus("error");
            setError(`${label} connection failed`);
            onFailed?.();
            break;
          case "closed":
            setStatus("disconnected");
            break;
          case "disconnected":
            // ICE disconnected is often transient — wait before escalating
            setStatus("connecting");
            break;
        }
      };
    },
    []
  );

  // ── Video ───────────────────────────────────────

  const connectVideo = useCallback(async () => {
    try {
      setVideoStatus("connecting");
      setError(null);
      const session = await ensureSession();
      await attachVideoPlugin(session);
    } catch (err) {
      setVideoStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect video");
    }
  }, [ensureSession, streamId]);

  const attachVideoPlugin = useCallback(
    async (session: JanusSession) => {
      // Clean up any existing video PC
      videoPcRef.current?.close();
      videoPcRef.current = null;

      const handleId = await session.attach(
        "janus.plugin.streaming",
        (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => {
          if (jsep && jsep.type === "offer") {
            handleStreamingOffer(session, handleId, jsep);
          }
        }
      );
      videoHandleRef.current = handleId;
      await session.sendMessage(handleId, { request: "watch", id: streamId });
    },
    [streamId]
  );

  const handleStreamingOffer = useCallback(
    async (session: JanusSession, handleId: number, offer: RTCSessionDescriptionInit) => {
      try {
        const pc = new RTCPeerConnection({ iceServers });
        videoPcRef.current = pc;

        watchIceState(pc, setVideoStatus, "Video", () => {
          // ICE failed — tear down and retry after a delay
          scheduleVideoReconnect();
        });

        pc.ontrack = (ev) => {
          if (videoRef.current && ev.streams[0]) {
            videoRef.current.srcObject = ev.streams[0];
          }
        };

        pc.onicecandidate = (ev) => {
          session.trickle(handleId, ev.candidate);
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await session.sendMessage(handleId, { request: "start" }, answer);
      } catch (err) {
        setVideoStatus("error");
        setError(err instanceof Error ? err.message : "Failed to process video offer");
        scheduleVideoReconnect();
      }
    },
    [watchIceState]
  );

  const videoReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleVideoReconnect = useCallback(() => {
    if (destroyedRef.current || videoReconnectTimer.current) return;
    console.log("[WebRTC] Scheduling video reconnect in 3s");
    videoReconnectTimer.current = setTimeout(() => {
      videoReconnectTimer.current = null;
      if (!destroyedRef.current) reattachVideo();
    }, 3_000);
  }, []);

  const reattachVideo = useCallback(async () => {
    if (destroyedRef.current) return;
    try {
      setVideoStatus("connecting");
      const session = janusRef.current;
      if (!session?.connected) return; // wait for Janus reconnect
      // Detach old handle if any
      if (videoHandleRef.current) {
        await session.detach(videoHandleRef.current).catch(() => {});
        videoHandleRef.current = null;
      }
      await attachVideoPlugin(session);
    } catch (err) {
      setVideoStatus("error");
      setError(err instanceof Error ? err.message : "Video reconnect failed");
      scheduleVideoReconnect();
    }
  }, [attachVideoPlugin, scheduleVideoReconnect]);

  const disconnectVideo = useCallback(() => {
    if (videoReconnectTimer.current) {
      clearTimeout(videoReconnectTimer.current);
      videoReconnectTimer.current = null;
    }
    if (videoHandleRef.current && janusRef.current) {
      janusRef.current.detach(videoHandleRef.current).catch(() => {});
      videoHandleRef.current = null;
    }
    videoPcRef.current?.close();
    videoPcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setVideoStatus("disconnected");
  }, []);

  // ── Audio ───────────────────────────────────────

  const connectAudio = useCallback(async () => {
    try {
      setAudioStatus("connecting");
      setError(null);
      wasAudioConnectedRef.current = true;

      const session = await ensureSession();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((t) => (t.enabled = false));

      await attachAudioPlugin(session, stream);
    } catch (err) {
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Failed to access microphone");
    }
  }, [ensureSession, audiobridgeRoom]);

  const attachAudioPlugin = useCallback(
    async (session: JanusSession, stream: MediaStream) => {
      audioPcRef.current?.close();
      audioPcRef.current = null;

      const pc = new RTCPeerConnection({ iceServers });
      audioPcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.ontrack = (ev) => {
        const audio = new Audio();
        audio.srcObject = ev.streams[0];
        audio.play().catch(() => {});
      };

      const handleId = await session.attach(
        "janus.plugin.audiobridge",
        async (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => {
          if (jsep && jsep.type === "answer" && audioPcRef.current) {
            await audioPcRef.current.setRemoteDescription(
              new RTCSessionDescription(jsep)
            );
          }
          const event = msg.plugindata?.data?.audiobridge as string | undefined;
          if (event === "joined") {
            await sendAudioOffer(session, handleId);
          }
        }
      );
      audioHandleRef.current = handleId;

      watchIceState(pc, setAudioStatus, "Audio", () => {
        scheduleAudioReconnect();
      });

      pc.onicecandidate = (ev) => {
        session.trickle(handleId, ev.candidate);
      };

      await session.sendMessage(handleId, {
        request: "join",
        room: audiobridgeRoom,
        muted: isMuted,
      });
    },
    [audiobridgeRoom, isMuted]
  );

  const sendAudioOffer = useCallback(
    async (session: JanusSession, handleId: number) => {
      const pc = audioPcRef.current;
      if (!pc) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await session.sendMessage(handleId, { request: "configure", muted: isMuted }, offer);
        setAudioStatus("connected");
      } catch (err) {
        setAudioStatus("error");
        setError(err instanceof Error ? err.message : "Audio negotiation failed");
      }
    },
    [isMuted]
  );

  const audioReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAudioReconnect = useCallback(() => {
    if (destroyedRef.current || audioReconnectTimer.current) return;
    console.log("[WebRTC] Scheduling audio reconnect in 3s");
    audioReconnectTimer.current = setTimeout(() => {
      audioReconnectTimer.current = null;
      if (!destroyedRef.current && wasAudioConnectedRef.current) reattachAudio();
    }, 3_000);
  }, []);

  const reattachAudio = useCallback(async () => {
    if (destroyedRef.current) return;
    try {
      setAudioStatus("connecting");
      const session = janusRef.current;
      if (!session?.connected) return;
      if (audioHandleRef.current) {
        await session.detach(audioHandleRef.current).catch(() => {});
        audioHandleRef.current = null;
      }
      // Re-use existing mic stream or get a new one
      let stream = localStreamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
      }
      await attachAudioPlugin(session, stream);
    } catch (err) {
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Audio reconnect failed");
      scheduleAudioReconnect();
    }
  }, [attachAudioPlugin, isMuted, scheduleAudioReconnect]);

  const disconnectAudio = useCallback(() => {
    wasAudioConnectedRef.current = false;
    if (audioReconnectTimer.current) {
      clearTimeout(audioReconnectTimer.current);
      audioReconnectTimer.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (audioHandleRef.current && janusRef.current) {
      janusRef.current.detach(audioHandleRef.current).catch(() => {});
      audioHandleRef.current = null;
    }
    audioPcRef.current?.close();
    audioPcRef.current = null;
    setAudioStatus("disconnected");
    setIsMuted(true);
  }, []);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !newMuted;
    });
    if (audioHandleRef.current && janusRef.current) {
      janusRef.current.sendMessage(audioHandleRef.current, {
        request: "configure",
        muted: newMuted,
      });
    }
  }, [isMuted]);

  // ── Lifecycle ───────────────────────────────────

  useEffect(() => {
    destroyedRef.current = false;
    if (autoConnect) {
      connectVideo();
    }
    return () => {
      destroyedRef.current = true;
      disconnectVideo();
      disconnectAudio();
      janusRef.current?.destroy();
      janusRef.current = null;
    };
  }, []);

  return {
    videoRef,
    videoStatus,
    audioStatus,
    signalingStatus,
    isMuted,
    error,
    connectVideo,
    disconnectVideo,
    connectAudio,
    disconnectAudio,
    toggleMute,
  };
}
