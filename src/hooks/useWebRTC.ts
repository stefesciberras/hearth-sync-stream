import { useState, useRef, useCallback, useEffect } from "react";
import { JanusSession } from "@/lib/janus";
import type { JanusMessage, JanusConnectionState } from "@/lib/janus";
import { debugLog } from "@/lib/debugLog";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebRTCOptions {
  signalingUrl: string;
  videoroomRoom?: number;
  autoConnect?: boolean;
  iceServers?: RTCIceServer[];
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export function useWebRTC({
  signalingUrl,
  videoroomRoom = 1234,
  autoConnect = true,
  iceServers: iceServersOption,
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
  const subscriberHandleRef = useRef<number | null>(null);

  const iceServers: RTCIceServer[] =
    iceServersOption && iceServersOption.length > 0
      ? iceServersOption
      : DEFAULT_ICE_SERVERS;

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
        debugLog.info("WebRTC", `${label} ICE state: ${pc.iceConnectionState}`);
        switch (pc.iceConnectionState) {
          case "connected":
          case "completed":
            setStatus("connected");
            break;
          case "failed":
            setStatus("error");
            setError(`${label} connection failed`);
            debugLog.error("WebRTC", `${label} ICE failed`);
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
      pc.onconnectionstatechange = () => {
        debugLog.debug("WebRTC", `${label} PC state: ${pc.connectionState}`);
      };
      pc.onicegatheringstatechange = () => {
        debugLog.debug("WebRTC", `${label} ICE gathering: ${pc.iceGatheringState}`);
      };
      pc.onicecandidateerror = (ev) => {
        const e = ev as RTCPeerConnectionIceErrorEvent;
        debugLog.warn("WebRTC", `${label} ICE candidate error`, {
          url: e.url,
          errorCode: e.errorCode,
          errorText: e.errorText,
        });
      };
    },
    []
  );

  // ── Video (VideoRoom subscriber) ─────────────────

  const connectVideo = useCallback(async () => {
    try {
      setVideoStatus("connecting");
      setError(null);
      debugLog.info("Video", `Connecting to room ${videoroomRoom}`);
      const session = await ensureSession();
      await attachVideoPlugin(session);
    } catch (err) {
      setVideoStatus("error");
      const msg = err instanceof Error ? err.message : "Failed to connect video";
      setError(msg);
      debugLog.error("Video", "Connect failed", msg);
    }
  }, [ensureSession, videoroomRoom]);

  const attachVideoPlugin = useCallback(
    async (session: JanusSession) => {
      // Clean up any existing video PC
      videoPcRef.current?.close();
      videoPcRef.current = null;

      const handleId = await session.attach(
        "janus.plugin.videoroom",
        async (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => {
          const event = msg.plugindata?.data?.videoroom as string | undefined;

          if (event === "attached" && jsep && jsep.type === "offer") {
            // We got a publisher's offer — create answer
            await handleSubscriberOffer(session, handleId, jsep);
          }
          if (event === "event") {
            // Check for new publishers we can subscribe to
            const publishers = msg.plugindata?.data?.publishers as Array<{ id: number }> | undefined;
            if (publishers && publishers.length > 0) {
              // Subscribe to the first publisher (single camera)
              const feedId = publishers[0].id;
              await subscribeToFeed(session, feedId);
            }
          }
          if (event === "joined") {
            // We joined as subscriber — check for existing publishers
            const publishers = msg.plugindata?.data?.publishers as Array<{ id: number }> | undefined;
            if (publishers && publishers.length > 0) {
              const feedId = publishers[0].id;
              await subscribeToFeed(session, feedId);
            }
          }
        }
      );
      videoHandleRef.current = handleId;

      // Join as publisher (but don't publish) to discover existing feeds
      await session.sendMessage(handleId, {
        request: "join",
        room: videoroomRoom,
        ptype: "publisher",
        display: "secureview-monitor",
      });
    },
    [videoroomRoom]
  );

  const subscribeToFeed = useCallback(
    async (session: JanusSession, feedId: number) => {
      // If we already have a subscriber handle, detach it
      if (subscriberHandleRef.current) {
        await session.detach(subscriberHandleRef.current).catch(() => {});
        subscriberHandleRef.current = null;
      }

      const subHandleId = await session.attach(
        "janus.plugin.videoroom",
        async (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => {
          const event = msg.plugindata?.data?.videoroom as string | undefined;
          if (event === "attached" && jsep && jsep.type === "offer") {
            await handleSubscriberOffer(session, subHandleId, jsep);
          }
          if (event === "updated" && jsep && jsep.type === "offer") {
            await handleSubscriberOffer(session, subHandleId, jsep);
          }
        }
      );
      subscriberHandleRef.current = subHandleId;

      await session.sendMessage(subHandleId, {
        request: "join",
        room: videoroomRoom,
        ptype: "subscriber",
        feed: feedId,
      });
    },
    [videoroomRoom]
  );

  const handleSubscriberOffer = useCallback(
    async (session: JanusSession, handleId: number, offer: RTCSessionDescriptionInit) => {
      try {
        const pc = new RTCPeerConnection({ iceServers });
        videoPcRef.current?.close();
        videoPcRef.current = pc;

        watchIceState(pc, setVideoStatus, "Video", () => {
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
      if (!session?.connected) return;
      // Detach old handles
      if (subscriberHandleRef.current) {
        await session.detach(subscriberHandleRef.current).catch(() => {});
        subscriberHandleRef.current = null;
      }
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
    if (subscriberHandleRef.current && janusRef.current) {
      janusRef.current.detach(subscriberHandleRef.current).catch(() => {});
      subscriberHandleRef.current = null;
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

  // ── Audio (VideoRoom publisher) ──────────────────

  const connectAudio = useCallback(async () => {
    try {
      setAudioStatus("connecting");
      setError(null);
      wasAudioConnectedRef.current = true;
      debugLog.info("Audio", "Requesting microphone");

      const session = await ensureSession();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((t) => (t.enabled = false));
      debugLog.info("Audio", `Microphone acquired (${stream.getAudioTracks().length} track[s])`);

      await attachAudioPlugin(session, stream);
    } catch (err) {
      setAudioStatus("error");
      const msg = err instanceof Error ? err.message : "Failed to access microphone";
      setError(msg);
      debugLog.error("Audio", "Connect failed", msg);
    }
  }, [ensureSession]);

  const attachAudioPlugin = useCallback(
    async (session: JanusSession, stream: MediaStream) => {
      audioPcRef.current?.close();
      audioPcRef.current = null;

      const pc = new RTCPeerConnection({ iceServers });
      audioPcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const handleId = await session.attach(
        "janus.plugin.videoroom",
        async (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => {
          if (jsep && jsep.type === "answer" && audioPcRef.current) {
            await audioPcRef.current.setRemoteDescription(
              new RTCSessionDescription(jsep)
            );
          }
          const event = msg.plugindata?.data?.videoroom as string | undefined;
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
        room: videoroomRoom,
        ptype: "publisher",
        display: "secureview-audio",
      });
    },
    [videoroomRoom, isMuted]
  );

  const sendAudioOffer = useCallback(
    async (session: JanusSession, handleId: number) => {
      const pc = audioPcRef.current;
      if (!pc) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await session.sendMessage(
          handleId,
          { request: "configure", audio: true, video: false },
          offer
        );
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
        audio: !newMuted,
        video: false,
      });
    }
  }, [isMuted]);

  // ── Lifecycle ───────────────────────────────────

  useEffect(() => {
    destroyedRef.current = false;
    debugLog.info("WebRTC", `Hook initialized with signalingUrl=${signalingUrl} room=${videoroomRoom}`);
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
