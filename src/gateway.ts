/**
 * QQ Bot Gateway - WebSocket 连接管理
 * 简化版，无 OpenClaw 依赖
 */
import WebSocket from "ws";
import type {
  C2CMessageEvent,
  GroupMessageEvent,
  GuildMessageEvent,
  WSPayload,
  PushedMessage,
  GatewayState
} from "./types.js";
import {
  getAccessToken,
  getGatewayUrl,
  clearTokenCache,
  PLUGIN_USER_AGENT
} from "./api.js";

// QQ Bot intents
const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
};

// 使用完整权限
const FULL_INTENTS = INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.DIRECT_MESSAGE | INTENTS.GROUP_AND_C2C;

// 重连配置
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];
const RATE_LIMIT_DELAY = 60000;
const MAX_RECONNECT_ATTEMPTS = 100;

export interface GatewayConfig {
  appId: string;
  clientSecret: string;
  onMessage?: (message: PushedMessage) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

export type MessageCallback = (message: PushedMessage) => void;

/**
 * Gateway 连接管理器
 */
export class QQBotGateway {
  private config: GatewayConfig;
  private state: GatewayState = {
    connected: false,
    sessionId: null,
    lastSeq: null,
    lastHeartbeat: null,
    reconnectAttempts: 0,
  };

  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isAborted = false;
  private isConnecting = false;
  private shouldRefreshToken = false;
  private messageCallbacks: Set<MessageCallback> = new Set();

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  /**
   * 添加消息回调
   */
  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.add(callback);
  }

  /**
   * 移除消息回调
   */
  offMessage(callback: MessageCallback): void {
    this.messageCallbacks.delete(callback);
  }

  /**
   * 获取当前状态
   */
  getState(): GatewayState {
    return { ...this.state };
  }

  /**
   * 启动连接
   */
  async start(): Promise<void> {
    this.isAborted = false;
    await this.connect();
  }

  /**
   * 停止连接
   */
  stop(): void {
    this.isAborted = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
  }

  /**
   * 发送消息给所有回调
   */
  private emitMessage(message: PushedMessage): void {
    // 调用配置中的回调
    this.config.onMessage?.(message);
    // 调用动态添加的回调
    for (const callback of this.messageCallbacks) {
      try {
        callback(message);
      } catch (err) {
        this.config.log?.error(`Message callback error: ${err}`);
      }
    }
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close();
    }
    this.ws = null;
    this.state.connected = false;
  }

  private getReconnectDelay(): number {
    const idx = Math.min(this.state.reconnectAttempts, RECONNECT_DELAYS.length - 1);
    return RECONNECT_DELAYS[idx];
  }

  private scheduleReconnect(customDelay?: number): void {
    if (this.isAborted || this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.config.log?.error("Max reconnect attempts reached or aborted");
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const delay = customDelay ?? this.getReconnectDelay();
    this.state.reconnectAttempts++;
    this.config.log?.info(`Reconnecting in ${delay}ms (attempt ${this.state.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isAborted) {
        this.connect();
      }
    }, delay);
  }

  private async connect(): Promise<void> {
    if (this.isConnecting) {
      this.config.log?.debug?.("Already connecting, skip");
      return;
    }
    this.isConnecting = true;

    try {
      this.cleanup();

      if (this.shouldRefreshToken) {
        this.config.log?.info("Refreshing token...");
        clearTokenCache(this.config.appId);
        this.shouldRefreshToken = false;
      }

      const accessToken = await getAccessToken(this.config.appId, this.config.clientSecret);
      this.config.log?.info("Access token obtained successfully");

      const gatewayUrl = await getGatewayUrl(accessToken);
      this.config.log?.info(`Connecting to ${gatewayUrl}`);

      const ws = new WebSocket(gatewayUrl, {
        headers: { "User-Agent": PLUGIN_USER_AGENT }
      });
      this.ws = ws;

      ws.on("open", () => {
        this.config.log?.info("WebSocket connected");
        this.isConnecting = false;
      });

      ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(data, accessToken);
      });

      ws.on("close", (code: number, reason: Buffer) => {
        this.config.log?.info(`WebSocket closed: ${code} ${reason.toString()}`);
        this.state.connected = false;
        this.isConnecting = false;
        if (!this.isAborted) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        this.config.log?.error(`WebSocket error: ${err.message}`);
        this.config.onError?.(err);
        this.isConnecting = false;
      });

    } catch (err) {
      this.isConnecting = false;
      const errMsg = String(err);
      this.config.log?.error(`Connection failed: ${err}`);

      if (errMsg.includes("Too many requests") || errMsg.includes("100001")) {
        this.config.log?.info(`Rate limited, waiting ${RATE_LIMIT_DELAY}ms`);
        this.scheduleReconnect(RATE_LIMIT_DELAY);
      } else {
        this.scheduleReconnect();
      }
    }
  }

  private handleMessage(data: WebSocket.RawData, accessToken: string): void {
    const payload: WSPayload = JSON.parse(data.toString());

    // 更新序列号
    if (payload.s !== undefined) {
      this.state.lastSeq = payload.s;
    }

    switch (payload.op) {
      case 10: // Hello
        this.handleHello(payload, accessToken);
        break;
      case 11: // Heartbeat ACK
        this.state.lastHeartbeat = Date.now();
        this.config.log?.debug?.("Heartbeat ACK received");
        break;
      case 0: // Dispatch
        this.handleDispatch(payload);
        break;
      case 9: // Invalid Session
        this.config.log?.error("Invalid session, reconnecting...");
        this.state.sessionId = null;
        this.shouldRefreshToken = true;
        this.scheduleReconnect();
        break;
      case 7: // Reconnect
        this.config.log?.info("Server requested reconnect");
        this.scheduleReconnect();
        break;
    }
  }

  private handleHello(payload: WSPayload, accessToken: string): void {
    const helloData = payload.d as { heartbeat_interval?: number };
    const heartbeatInterval = helloData?.heartbeat_interval ?? 41250;

    // 开始心跳
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 11, d: this.state.lastSeq }));
        this.config.log?.debug?.("Heartbeat sent");
      }
    }, heartbeatInterval);

    // 发送 Identify 或 Resume
    if (this.state.sessionId && this.state.lastSeq !== null) {
      // Resume
      this.config.log?.info(`Resuming session: ${this.state.sessionId}`);
      this.ws?.send(JSON.stringify({
        op: 6,
        d: {
          token: `QQBot ${accessToken}`,
          session_id: this.state.sessionId,
          seq: this.state.lastSeq,
        }
      }));
    } else {
      // Identify
      this.config.log?.info("Sending Identify");
      this.ws?.send(JSON.stringify({
        op: 2,
        d: {
          token: `QQBot ${accessToken}`,
          intents: FULL_INTENTS,
          shard: [0, 1],
          properties: {
            $os: process.platform,
            $browser: "qqbot-gateway",
            $device: "qqbot-gateway",
          },
        }
      }));
    }
  }

  private handleDispatch(payload: WSPayload): void {
    const { t, d } = payload;

    // 打印所有收到的事件类型（调试）
    this.config.log?.info(`收到事件: ${t}`);

    switch (t) {
      case "READY":
        this.handleReady(d as Record<string, unknown>);
        break;
      case "RESUMED":
        this.config.log?.info("Session resumed");
        this.state.connected = true;
        break;
      case "C2C_MESSAGE_CREATE":
        this.handleMessageCreate(d as C2CMessageEvent);
        break;
      case "GROUP_AT_MESSAGE_CREATE":
        this.handleGroupMessage(d as GroupMessageEvent);
        break;
      case "AT_MESSAGE_CREATE":
        this.handleGuildMessage(d as GuildMessageEvent);
        break;
      default:
        // 打印未处理的事件
        this.config.log?.debug?.(`未处理的事件: ${t}`);
    }
  }

  private handleReady(data: Record<string, unknown>): void {
    this.state.sessionId = data.session_id as string;
    this.state.connected = true;
    this.state.reconnectAttempts = 0;
    this.config.log?.info(`Gateway ready, session: ${this.state.sessionId}`);
    this.config.onReady?.();
  }

  private handleMessageCreate(event: C2CMessageEvent): void {
    const message: PushedMessage = {
      type: "c2c",
      sender: {
        id: event.author.id,
        openid: event.author.user_openid,
      },
      content: event.content,
      messageId: event.id,
      timestamp: parseInt(event.timestamp) * 1000,
      attachments: event.attachments,
    };
    this.emitMessage(message);
  }

  private handleGroupMessage(event: GroupMessageEvent): void {
    const message: PushedMessage = {
      type: "group",
      sender: {
        id: event.author.id,
        openid: event.author.member_openid,
      },
      content: event.content,
      messageId: event.id,
      timestamp: parseInt(event.timestamp) * 1000,
      groupOpenid: event.group_openid,
      attachments: event.attachments,
    };
    this.emitMessage(message);
  }

  private handleGuildMessage(event: GuildMessageEvent): void {
    const message: PushedMessage = {
      type: "channel",
      sender: {
        id: event.author.id,
        openid: event.author.id,
        nickname: event.author.username || event.member?.nick,
      },
      content: event.content,
      messageId: event.id,
      timestamp: parseInt(event.timestamp) * 1000,
      channelId: event.channel_id,
      guildId: event.guild_id,
      attachments: event.attachments,
    };
    this.emitMessage(message);
  }
}
