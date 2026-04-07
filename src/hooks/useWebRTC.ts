import { useState, useRef, useCallback, useEffect } from "react";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebRTCOptions {
  signalingUrl: string;
  autoConnect?: boolean;
}

export function useWebRTC({ signalingUrl, autoConnect = true }: UseWebRTCOptions) {
  const [videoStatus, setVideoStatus] = useState<ConnectionStatus>("disconnected");
  const [audioStatus, setAudioStatus] = useState<ConnectionStatus>("disconnected");
  const [isMuted, setIsMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const connectVideo = useCallback(async () => {
    try {
      setVideoStatus("connecting");
      setError(null);

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      peerConnectionRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      pc.oniceconnectionstatechange = () => {
        switch (pc.iceConnectionState) {
          case "connected":
          case "completed":
            setVideoStatus("connected");
            break;
          case "failed":
          case "closed":
            setVideoStatus("error");
            setError("Video connection lost");
            break;
          case "disconnected":
            setVideoStatus("connecting");
            break;
        }
      };

      // In a real implementation, you'd connect to your signaling server here:
      // const ws = new WebSocket(signalingUrl);
      // Exchange SDP offers/answers and ICE candidates via the signaling server
      
      // For demo purposes, set connected after a brief delay
      setVideoStatus("connected");

    } catch (err) {
      setVideoStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect video");
    }
  }, [signalingUrl]);

  const disconnectVideo = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setVideoStatus("disconnected");
  }, []);

  const connectAudio = useCallback(async () => {
    try {
      setAudioStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      // Mute by default
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });

      // In a real implementation, add audio tracks to the peer connection
      // and handle remote audio tracks
      
      setAudioStatus("connected");
    } catch (err) {
      setAudioStatus("error");
      setError(err instanceof Error ? err.message : "Failed to access microphone");
    }
  }, [isMuted]);

  const disconnectAudio = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setAudioStatus("disconnected");
    setIsMuted(true);
  }, []);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted;
    });
  }, [isMuted]);

  useEffect(() => {
    if (autoConnect) {
      connectVideo();
    }
    return () => {
      disconnectVideo();
      disconnectAudio();
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
