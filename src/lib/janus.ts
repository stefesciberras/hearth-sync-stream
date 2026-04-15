/**
 * Janus WebSocket signaling client.
 *
 * Handles:
 *  - Session creation & keep-alive
 *  - Plugin attachment (streaming for video, audiobridge for intercom)
 *  - SDP offer/answer exchange
 *  - Trickle ICE
 */

export type JanusEventCallback = (msg: JanusMessage, jsep?: RTCSessionDescriptionInit) => void;

export interface JanusMessage {
  janus: string;
  transaction?: string;
  session_id?: number;
  sender?: number;
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

export class JanusSession {
  private ws: WebSocket | null = null;
  private sessionId: number | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private transactions = new Map<string, (msg: JanusMessage) => void>();
  private handles = new Map<number, JanusEventCallback>();
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  /** Connect WebSocket and create a Janus session */
  async connect(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, "janus-protocol");

      this.ws.onopen = () => {
        this.send({ janus: "create" }).then((resp) => {
          this.sessionId = resp.data?.id as number;
          this.startKeepAlive();
          resolve(this.sessionId);
        }).catch(reject);
      };

      this.ws.onerror = (e) => reject(new Error("WebSocket error"));
      this.ws.onclose = () => this.cleanup();
      this.ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  /** Attach to a Janus plugin and return the handle id */
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

  /** Send a message body (+ optional JSEP) to a plugin handle */
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

  /** Trickle an ICE candidate (or null for end-of-candidates) */
  trickle(handleId: number, candidate: RTCIceCandidate | null): void {
    const msg: Record<string, unknown> = {
      janus: "trickle",
      session_id: this.sessionId!,
      handle_id: handleId,
      candidate: candidate ? candidate.toJSON() : { completed: true },
    };
    // Fire-and-forget
    this.rawSend(msg);
  }

  /** Detach a plugin handle */
  async detach(handleId: number): Promise<void> {
    this.handles.delete(handleId);
    await this.send({
      janus: "detach",
      session_id: this.sessionId!,
      handle_id: handleId,
    }).catch(() => {});
  }

  /** Destroy the session and close the socket */
  destroy(): void {
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

    // Transaction-matched response
    if (msg.transaction && this.transactions.has(msg.transaction)) {
      // "ack" messages are not final — wait for the actual response
      if (msg.janus === "ack") return;
      const cb = this.transactions.get(msg.transaction)!;
      this.transactions.delete(msg.transaction);
      cb(msg);
      return;
    }

    // Asynchronous event routed to a plugin handle
    if (msg.sender && this.handles.has(msg.sender)) {
      const handler = this.handles.get(msg.sender)!;
      handler(msg, msg.jsep);
    }
  }

  private startKeepAlive(): void {
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.sessionId) {
        this.rawSend({ janus: "keepalive", session_id: this.sessionId });
      }
    }, 25_000);
  }

  private cleanup(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    this.transactions.clear();
    this.handles.clear();
    this.sessionId = null;
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
      this.ws = null;
    }
  }
}
