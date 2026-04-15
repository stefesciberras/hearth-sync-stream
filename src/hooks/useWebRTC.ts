import { useState, useRef, useCallback, useEffect } from "react";
import { JanusSession } from "@/lib/janus";
import type { JanusMessage } from "@/lib/janus";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebRTCOptions {
  /** Janus WebSocket URL, e.g. wss://janus.example.com */
  signalingUrl: string;
  /** Janus Streaming plugin mount-point / stream ID for the camera feed */
  streamId?: number;
  /** Janus AudioBridge room ID for the intercom */
  audiobridgeRoom?: number;
  /** Auto-connect to the video stream on mount */
  autoConnect?: boolean;
}

export function useWebRTC({
  signalingUrl,
  streamId = 1,
  audiobridgeRoom = 1234,
  autoConnect = true,
}: UseWebRTCOptions) {
  const [videoStatus, setVideoStatus] = useState<ConnectionStatus>("disconnected");
  const [audioStatus, setAudioStatus] = useState<ConnectionStatus>("disconnected");
  const [isMuted, setIsMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const janusRef = useRef<JanusSession | null>(null);
  const videoPcRef = useRef<RTCPeerConnection | null>(null);
  const videoHandleRef = useRef<number | null>(null);
  const audioPcRef = useRef<RTCPeerConnection | null>(null);
  const audioHandleRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
  ];

  // ── Helpers ─────────────────────────────────────

  /** Ensure a shared Janus session exists */
  const ensureSession = useCallback(async (): Promise<JanusSession> => {
    if (janusRef.current?.connected) return janusRef.current;
    const session = new JanusSession(signalingUrl);
    await session.connect();
    janusRef.current = session;
    return session;
  }, [signalingUrl]);

  const watchIceState = useCallback(
    (pc: RTCPeerConnection, setStatus: (s: ConnectionStatus) => void, label: string) => {
      pc.oniceconnectionstatechange = () => {
        switch (pc.iceConnectionState) {
          case "connected":
          case "completed":
            setStatus("connected");
            break;
          case "failed":
          case "closed":
            setStatus("error");
            setError(`${label} connection lost`);
            break;
          case "disconnected":
            setStatus("connecting");
            break;
        }
      };
    },
    []
  );

  // ── Video (Janus Streaming plugin) ──────────────

  const connectVideo = useCallback(async () => {
    try {
      setVideoStatus("connecting");
      setError(null);

      const session = await ensureSession();

      // Attach to the Streaming plugin
      const handleId = await session.attach(
        "janus.plugin.streaming",
        (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => {
          // Janus sends an "offer" SDP when the stream is ready
          if (jsep && jsep.type === "offer") {
            handleStreamingOffer(session, handleId, jsep);
          }
        }
      );
      videoHandleRef.current = handleId;

      // Request the stream — Janus will respond asynchronously with an offer
      await session.sendMessage(handleId, { request: "watch", id: streamId });
    } catch (err) {
      setVideoStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect video");
    }
  }, [ensureSession, streamId]);

  const handleStreamingOffer = useCallback(
    async (session: JanusSession, handleId: number, offer: RTCSessionDescriptionInit) => {
      try {
        const pc = new RTCPeerConnection({ iceServers });
        videoPcRef.current = pc;
        watchIceState(pc, setVideoStatus, "Video");

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
      }
    },
    [watchIceState]
  );

  const disconnectVideo = useCallback(() => {
    if (videoHandleRef.current && janusRef.current) {
      janusRef.current.detach(videoHandleRef.current);
      videoHandleRef.current = null;
    }
    videoPcRef.current?.close();
    videoPcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setVideoStatus("disconnected");
  }, []);

  // ── Audio (Janus AudioBridge plugin) ────────────

  const connectAudio = useCallback(async () => {
    try {
      setAudioStatus("connecting");
      setError(null);

      const session = await ensureSession();

      // Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((t) => (t.enabled = false)); // start muted

      const handleId = await session.attach(
        "janus.plugin.audiobridge",
        async (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => {
          // Server sends an answer after we send our offer
          if (jsep && jsep.type === "answer" && audioPcRef.current) {
            await audioPcRef.current.setRemoteDescription(
              new RTCSessionDescription(jsep)
            );
          }

          // Handle events (e.g. participants joining/leaving)
          const event = msg.plugindata?.data?.audiobridge as string | undefined;
          if (event === "joined") {
            // We've joined — now create an offer and send it
            await sendAudioOffer(session, handleId);
          }
        }
      );
      audioHandleRef.current = handleId;

      // Create PeerConnection and add local audio
      const pc = new RTCPeerConnection({ iceServers });
      audioPcRef.current = pc;
      watchIceState(pc, setAudioStatus, "Audio");

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // Receive mixed audio from other participants
      pc.ontrack = (ev) => {
        const audio = new Audio();
        audio.srcObject = ev.streams[0];
        audio.play().catch(() => {});
      };

      pc.onicecandidate = (ev) => {
        session.trickle(handleId, ev.candidate);
      };

      // Join the audiobridge room — Janus will fire a "joined" event
      await session.sendMessage(handleId, {
        request: "join",
        room: audiobridgeRoom,
        muted: true,
      });
    } catch (err) {
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Failed to access microphone");
    }
  }, [ensureSession, audiobridgeRoom, watchIceState]);

  const sendAudioOffer = useCallback(
    async (session: JanusSession, handleId: number) => {
      const pc = audioPcRef.current;
      if (!pc) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await session.sendMessage(handleId, { request: "configure", muted: true }, offer);
        setAudioStatus("connected");
      } catch (err) {
        setAudioStatus("error");
        setError(err instanceof Error ? err.message : "Audio negotiation failed");
      }
    },
    []
  );

  const disconnectAudio = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    if (audioHandleRef.current && janusRef.current) {
      janusRef.current.detach(audioHandleRef.current);
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
    // Also tell Janus to mute/unmute server-side
    if (audioHandleRef.current && janusRef.current) {
      janusRef.current.sendMessage(audioHandleRef.current, {
        request: "configure",
        muted: newMuted,
      });
    }
  }, [isMuted]);

  // ── Lifecycle ───────────────────────────────────

  useEffect(() => {
    if (autoConnect) {
      connectVideo();
    }
    return () => {
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
    isMuted,
    error,
    connectVideo,
    disconnectVideo,
    connectAudio,
    disconnectAudio,
    toggleMute,
  };
}
