/**
 * Janus WebSocket signaling client with automatic reconnection.
 */

export type JanusEventCallback = (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => void;

export interface JanusMessage {
  janus: string;
  transaction?: string;
  session_id?: number;
  sender?: number;
  data?: { id: number; [key: string]: unknown };
  plugindata?: {
    plugin: string;
    data: Record<string, unknown>;
  };
  jsep?: RTCSessionDescriptionInit;
  [key: string]: unknown;
}

function randomTxId(): string {
  return Math.random().toString(36).substring(2, 14);
}

export type JanusConnectionState = "connected" | "disconnected" | "reconnecting";

export class JanusSession {
  private ws: WebSocket | null = null;
  private sessionId: number | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private transactions = new Map<string, (msg: JanusMessage) => void>();
  private handles = new Map<number, JanusEventCallback>();
  private url: string;

  // Reconnection state
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private readonly maxReconnectDelay = 30_000;
  private readonly baseReconnectDelay = 1_000;
  onConnectionStateChange?: (state: JanusConnectionState) => void;
  onReconnected?: () => void;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<number> {
    this.destroyed = false;
    this.reconnectAttempt = 0;
    return this.doConnect();
  }

  private doConnect(): Promise<number> {
    return new Promise((resolve, reject) => {
      debugLog.info("Janus", `Opening WebSocket → ${this.url}`);
      this.ws = new WebSocket(this.url, "janus-protocol");

      this.ws.onopen = () => {
        debugLog.info("Janus", "WebSocket open, creating session");
        this.send({ janus: "create" }).then((resp) => {
          this.sessionId = resp.data?.id as number;
          this.reconnectAttempt = 0;
          this.startKeepAlive();
          this.onConnectionStateChange?.("connected");
          debugLog.info("Janus", `Session created id=${this.sessionId}`);
          resolve(this.sessionId);
        }).catch((err) => {
          debugLog.error("Janus", "Session create failed", String(err));
          reject(err);
        });
      };

      this.ws.onerror = (ev) => {
        debugLog.error("Janus", "WebSocket error", { type: (ev as Event).type });
        // Only reject the initial connect; reconnects are handled internally
        if (this.reconnectAttempt === 0) reject(new Error("WebSocket error"));
      };

      this.ws.onclose = (ev) => {
        debugLog.warn("Janus", `WebSocket closed code=${ev.code} reason=${ev.reason || "(none)"}`);
        this.cleanupSocket();
        if (!this.destroyed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.onConnectionStateChange?.("reconnecting");

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay
    );
    this.reconnectAttempt++;

    debugLog.info("Janus", `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      try {
        await this.doConnect();
        // Re-established — notify hook so it can re-attach plugins
        this.onReconnected?.();
      } catch {
        // doConnect failed, onclose will fire again and re-schedule
      }
    }, delay);
  }

  async attach(plugin: string, onEvent: JanusEventCallback): Promise<number> {
    const resp = await this.send({
      janus: "attach",
      plugin,
      session_id: this.sessionId!,
    });
    const handleId = resp.data?.id as number;
    this.handles.set(handleId, onEvent);
    return handleId;
  }

  async sendMessage(
    handleId: number,
    body: Record<string, unknown>,
    jsep?: RTCSessionDescriptionInit
  ): Promise<JanusMessage> {
    const msg: Record<string, unknown> = {
      janus: "message",
      session_id: this.sessionId!,
      handle_id: handleId,
      body,
    };
    if (jsep) msg.jsep = jsep;
    return this.send(msg);
  }

  trickle(handleId: number, candidate: RTCIceCandidate | null): void {
    const msg: Record<string, unknown> = {
      janus: "trickle",
      session_id: this.sessionId!,
      handle_id: handleId,
      candidate: candidate ? candidate.toJSON() : { completed: true },
    };
    this.rawSend(msg);
  }

  async detach(handleId: number): Promise<void> {
    this.handles.delete(handleId);
    await this.send({
      janus: "detach",
      session_id: this.sessionId!,
      handle_id: handleId,
    }).catch(() => {});
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sessionId && this.ws?.readyState === WebSocket.OPEN) {
      this.rawSend({ janus: "destroy", session_id: this.sessionId });
    }
    this.cleanup();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.sessionId !== null;
  }

  // ── Internals ──────────────────────────────────

  private send(msg: Record<string, unknown>): Promise<JanusMessage> {
    return new Promise((resolve, reject) => {
      const txId = randomTxId();
      msg.transaction = txId;
      this.transactions.set(txId, (resp) => {
        if (resp.janus === "error") {
          reject(new Error(JSON.stringify(resp.error)));
        } else {
          resolve(resp);
        }
      });
      this.rawSend(msg);
      setTimeout(() => {
        if (this.transactions.has(txId)) {
          this.transactions.delete(txId);
          reject(new Error("Janus transaction timeout"));
        }
      }, 10_000);
    });
  }

  private rawSend(msg: Record<string, unknown>): void {
    if (!msg.transaction) msg.transaction = randomTxId();
    this.ws?.send(JSON.stringify(msg));
  }

  private onMessage(ev: MessageEvent): void {
    let msg: JanusMessage;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }

    if (msg.transaction && this.transactions.has(msg.transaction)) {
      if (msg.janus === "ack") return;
      const cb = this.transactions.get(msg.transaction)!;
      this.transactions.delete(msg.transaction);
      cb(msg);
      return;
    }

    if (msg.sender && this.handles.has(msg.sender)) {
      const handler = this.handles.get(msg.sender)!;
      handler(msg, msg.jsep);
    }
  }

  private startKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.sessionId) {
        this.rawSend({ janus: "keepalive", session_id: this.sessionId });
      }
    }, 25_000);
  }

  /** Clean up socket-level resources without clearing handles (for reconnect) */
  private cleanupSocket(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    this.transactions.forEach((_, key) => this.transactions.delete(key));
    this.sessionId = null;
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws = null;
    }
    this.onConnectionStateChange?.("disconnected");
  }

  /** Full cleanup including handles */
  private cleanup(): void {
    this.cleanupSocket();
    this.handles.clear();
  }
}
