/**
 * QQ Bot Gateway - WebSocket 连接管理
 * 修复版：正确的错误码处理 + Session 持久化 + 引用消息支持
 */
import WebSocket from "ws";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
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
  sendC2CInputNotify,
  onMessageSent,
  PLUGIN_USER_AGENT
} from "./api.js";

// ============ Session 持久化 ============
interface SessionData {
  sessionId: string;
  lastSeq: number | null;
  lastConnectedAt: number;
  accountId: string;
  appId: string;
  savedAt: number;
}

const SESSION_DIR = path.join(os.homedir(), ".qqbot-gateway", "sessions");
const SESSION_FILE = (accountId: string) => path.join(SESSION_DIR, `${accountId}.json`);

function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function loadSession(accountId: string, appId: string): SessionData | null {
  try {
    ensureSessionDir();
    const file = SESSION_FILE(accountId);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as SessionData;
    if (data.appId !== appId) {
      fs.unlinkSync(file);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveSession(data: SessionData): void {
  try {
    ensureSessionDir();
    fs.writeFileSync(SESSION_FILE(data.accountId), JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[gateway] Failed to save session: ${err}`);
  }
}

function clearSession(accountId: string): void {
  try {
    const file = SESSION_FILE(accountId);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    // ignore
  }
}

// ============ 引用消息索引 ============
interface RefEntry {
  content: string;
  senderId: string;
  senderName?: string;
  timestamp: number;
  isBot: boolean;
  attachments?: Array<{
    type: string;
    localPath?: string;
    filename?: string;
    url?: string;
    transcript?: string;
  }>;
}

const REF_INDEX_DIR = path.join(os.homedir(), ".qqbot-gateway", "data");
const REF_INDEX_FILE = path.join(REF_INDEX_DIR, "ref-index.jsonl");

interface RefIndexMap {
  [key: string]: RefEntry;
}

let refIndexCache: RefIndexMap = {};

function ensureRefIndexDir(): void {
  if (!fs.existsSync(REF_INDEX_DIR)) {
    fs.mkdirSync(REF_INDEX_DIR, { recursive: true });
  }
}

function loadRefIndex(): void {
  try {
    ensureRefIndexDir();
    if (!fs.existsSync(REF_INDEX_FILE)) {
      refIndexCache = {};
      return;
    }
    const lines = fs.readFileSync(REF_INDEX_FILE, "utf-8").split("\n").filter(Boolean);
    refIndexCache = {};
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { key: string; entry: RefEntry };
        refIndexCache[entry.key] = entry.entry;
      } catch {
        // ignore invalid lines
      }
    }
  } catch {
    refIndexCache = {};
  }
}

function saveRefIndex(key: string, entry: RefEntry): void {
  refIndexCache[key] = entry;
  try {
    ensureRefIndexDir();
    const lines = Object.entries(refIndexCache).map(([k, e]) =>
      JSON.stringify({ key: k, entry: e })
    );
    fs.writeFileSync(REF_INDEX_FILE, lines.join("\n"));
  } catch (err) {
    console.error(`[gateway] Failed to save ref index: ${err}`);
  }
}

function getRefIndex(key: string): RefEntry | undefined {
  return refIndexCache[key];
}

function flushRefIndex(): void {
  try {
    ensureRefIndexDir();
    const lines = Object.entries(refIndexCache).map(([k, e]) =>
      JSON.stringify({ key: k, entry: e })
    );
    fs.writeFileSync(REF_INDEX_FILE, lines.join("\n"));
  } catch (err) {
    console.error(`[gateway] Failed to flush ref index: ${err}`);
  }
}

// 解析引用消息索引
function parseRefIndices(ext?: string[]): { refMsgIdx?: string; msgIdx?: string } {
  if (!ext || !Array.isArray(ext)) return {};
  const refMsgIdx = ext.find(e => e?.startsWith("REFIDX_"));
  const msgIdx = ext.find(e => e?.startsWith("MSGIDX_"));
  return { refMsgIdx, msgIdx };
}

// ============ 已知用户 ============
interface KnownUser {
  openid: string;
  type: "c2c" | "group";
  nickname?: string;
  groupOpenid?: string;
  accountId: string;
  lastSeen: number;
}

const KNOWN_USERS_FILE = path.join(REF_INDEX_DIR, "known-users.json");
let knownUsersCache: Map<string, KnownUser> = new Map();
const KNOWN_USERS_KEY = (openid: string, accountId: string) => `${accountId}:${openid}`;

function loadKnownUsers(): Map<string, KnownUser> {
  try {
    ensureRefIndexDir();
    if (!fs.existsSync(KNOWN_USERS_FILE)) {
      knownUsersCache = new Map();
      return knownUsersCache;
    }
    const data = JSON.parse(fs.readFileSync(KNOWN_USERS_FILE, "utf-8")) as KnownUser[];
    knownUsersCache = new Map(data.map(u => [KNOWN_USERS_KEY(u.openid, u.accountId), u]));
  } catch {
    knownUsersCache = new Map();
  }
  return knownUsersCache;
}

function recordKnownUser(user: Omit<KnownUser, "lastSeen">): void {
  const key = KNOWN_USERS_KEY(user.openid, user.accountId);
  knownUsersCache.set(key, { ...user, lastSeen: Date.now() });
}

function flushKnownUsers(): void {
  saveKnownUsersToFile(knownUsersCache);
}

// ============ 已知用户查询 API ============

/**
 * 获取一个已知用户
 */
export function getKnownUser(type: string, openid: string, accountId: string): KnownUser | undefined {
  const users = loadKnownUsers();
  const key = KNOWN_USERS_KEY(openid, accountId);
  return users.get(key);
}

/**
 * 列出已知用户
 */
export function listKnownUsers(options?: {
  type?: "c2c" | "group";
  accountId?: string;
  sortByLastInteraction?: boolean;
  limit?: number;
}): KnownUser[] {
  const users = loadKnownUsers();
  let result = Array.from(users.values());

  if (options?.type) {
    result = result.filter(u => u.type === options.type);
  }
  if (options?.accountId) {
    result = result.filter(u => u.accountId === options.accountId);
  }
  if (options?.sortByLastInteraction !== false) {
    result.sort((a, b) => b.lastSeen - a.lastSeen);
  }
  if (options?.limit && options.limit > 0) {
    result = result.slice(0, options.limit);
  }

  return result;
}

/**
 * 删除一个已知用户
 */
export function removeKnownUser(type: string, openid: string, accountId: string): boolean {
  const users = loadKnownUsers();
  const key = KNOWN_USERS_KEY(openid, accountId);
  const deleted = users.delete(key);
  if (deleted) {
    saveKnownUsersToFile(users);
  }
  return deleted;
}

/**
 * 清除所有已知用户
 */
export function clearKnownUsers(accountId?: string): number {
  const users = loadKnownUsers();
  let count = 0;

  if (accountId) {
    for (const [key, user] of users) {
      if (user.accountId === accountId) {
        users.delete(key);
        count++;
      }
    }
  } else {
    count = users.size;
    users.clear();
  }

  if (count > 0) {
    saveKnownUsersToFile(users);
  }
  return count;
}

/**
 * 获取已知用户统计
 */
export function getKnownUsersStats(accountId?: string): {
  total: number;
  c2c: number;
  group: number;
} {
  const users = listKnownUsers({ accountId });

  return {
    total: users.length,
    c2c: users.filter(u => u.type === "c2c").length,
    group: users.filter(u => u.type === "group").length,
  };
}

/**
 * 保存已知用户到文件（内部使用）
 */
function saveKnownUsersToFile(users: Map<string, KnownUser>): void {
  try {
    ensureRefIndexDir();
    const data = Array.from(users.values());
    fs.writeFileSync(KNOWN_USERS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[gateway] Failed to save known users: ${err}`);
  }
}

// ============ 消息回复限流器 ============
// 同一 message_id 1小时内最多回复 4 次，超过 1 小时无法被动回复（需改为主动消息）
const MESSAGE_REPLY_LIMIT = 4;
const MESSAGE_REPLY_TTL = 60 * 60 * 1000; // 1小时

interface MessageReplyRecord {
  count: number;
  firstReplyAt: number;
}

const messageReplyTracker = new Map<string, MessageReplyRecord>();

/** 限流检查结果 */
export interface ReplyLimitResult {
  allowed: boolean;
  remaining: number;
  shouldFallbackToProactive: boolean;
  fallbackReason?: "expired" | "limit_exceeded";
  message?: string;
}

/**
 * 检查是否可以回复该消息（限流检查）
 */
export function checkMessageReplyLimit(messageId: string): ReplyLimitResult {
  const now = Date.now();
  const record = messageReplyTracker.get(messageId);

  // 清理过期记录（定期清理，避免内存泄漏）
  if (messageReplyTracker.size > 10000) {
    for (const [id, rec] of messageReplyTracker) {
      if (now - rec.firstReplyAt > MESSAGE_REPLY_TTL) {
        messageReplyTracker.delete(id);
      }
    }
  }

  // 新消息，首次回复
  if (!record) {
    return {
      allowed: true,
      remaining: MESSAGE_REPLY_LIMIT,
      shouldFallbackToProactive: false,
    };
  }

  // 检查是否超过1小时（message_id 过期）
  if (now - record.firstReplyAt > MESSAGE_REPLY_TTL) {
    return {
      allowed: false,
      remaining: 0,
      shouldFallbackToProactive: true,
      fallbackReason: "expired",
      message: `消息已超过1小时有效期，将使用主动消息发送`,
    };
  }

  // 检查是否超过回复次数限制
  const remaining = MESSAGE_REPLY_LIMIT - record.count;
  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      shouldFallbackToProactive: true,
      fallbackReason: "limit_exceeded",
      message: `该消息已达到1小时内最大回复次数(${MESSAGE_REPLY_LIMIT}次)，将使用主动消息发送`,
    };
  }

  return {
    allowed: true,
    remaining,
    shouldFallbackToProactive: false,
  };
}

/**
 * 记录一次消息回复
 */
export function recordMessageReply(messageId: string): void {
  const now = Date.now();
  const record = messageReplyTracker.get(messageId);

  if (!record) {
    messageReplyTracker.set(messageId, { count: 1, firstReplyAt: now });
  } else {
    if (now - record.firstReplyAt > MESSAGE_REPLY_TTL) {
      messageReplyTracker.set(messageId, { count: 1, firstReplyAt: now });
    } else {
      record.count++;
    }
  }
  console.log(`[gateway] recordMessageReply: ${messageId}, count=${messageReplyTracker.get(messageId)?.count}`);
}

/**
 * 获取消息回复限制配置
 */
export function getMessageReplyConfig(): { limit: number; ttlMs: number; ttlHours: number } {
  return {
    limit: MESSAGE_REPLY_LIMIT,
    ttlMs: MESSAGE_REPLY_TTL,
    ttlHours: MESSAGE_REPLY_TTL / (60 * 60 * 1000),
  };
}

// ============ 输入状态保持 (TypingKeepAlive) ============
class TypingKeepAlive {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly interval = 25000; // 25秒续期一次
  private readonly totalDuration = 120000; // 最多保持2分钟

  constructor(
    private getToken: () => Promise<string>,
    private clearToken: () => void,
    private senderId: string,
    private messageId?: string,
    private log?: { info?: (msg: string) => void; error?: (msg: string) => void },
    private prefix?: string
  ) {}

  start(): void {
    this.stop();
    const elapsed = { count: 0 };
    this.timer = setInterval(async () => {
      elapsed.count++;
      if (elapsed.count * this.interval >= this.totalDuration) {
        this.stop();
        return;
      }
      try {
        const token = await this.getToken();
        await sendC2CInputNotify(token, this.senderId, this.messageId, 30);
        this.log?.info?.(`${this.prefix}Typing keepalive sent`);
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes("token") || errMsg.includes("401") || errMsg.includes("11244")) {
          this.clearToken();
          try {
            const token = await this.getToken();
            await sendC2CInputNotify(token, this.senderId, this.messageId, 30);
          } catch {
            this.stop();
          }
        } else {
          this.stop();
        }
      }
    }, this.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

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
const FULL_INTENTS_DESC = "群聊+私信+频道";

// 重连配置
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];
const RATE_LIMIT_DELAY = 60000;
const MAX_RECONNECT_ATTEMPTS = 100;
const MAX_QUICK_DISCONNECT_COUNT = 3; // 连续快速断开次数阈值
const QUICK_DISCONNECT_THRESHOLD = 5000; // 5秒内断开视为快速断开

// 心跳配置
const HEARTBEAT_MISS_LIMIT = 3; // 连续丢失 N 次 ACK 后断开重连

export interface GatewayConfig {
  appId: string;
  clientSecret: string;
  accountId?: string; // 用于 session 持久化
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
  private accountId: string;
  private state: GatewayState = {
    connected: false,
    sessionId: null,
    lastSeq: null,
    lastHeartbeat: null,
    reconnectAttempts: 0,
  };

  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isAborted = false;
  private isConnecting = false;
  private shouldRefreshToken = false;
  private messageCallbacks: Set<MessageCallback> = new Set();

  // 快速断开检测
  private lastConnectTime = 0;
  private quickDisconnectCount = 0;

  // 输入状态保持
  private typingKeepAlive: TypingKeepAlive | null = null;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.accountId = config.accountId || "default";
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
   * 开始发送输入状态（机器人正在输入）
   * @param openid 目标用户的 openid
   * @param msgId 回复的消息 ID（可选）
   */
  async startTyping(openid: string, msgId?: string): Promise<void> {
    try {
      const token = await getAccessToken(this.config.appId, this.config.clientSecret);
      await sendC2CInputNotify(token, openid, msgId, 30);
      this.typingKeepAlive = new TypingKeepAlive(
        () => getAccessToken(this.config.appId, this.config.clientSecret),
        () => clearTokenCache(this.config.appId),
        openid,
        msgId,
        this.config.log,
        `[gateway:${this.accountId}]`
      );
      this.typingKeepAlive.start();
    } catch (err) {
      this.config.log?.debug?.(`[gateway:${this.accountId}] startTyping error: ${err}`);
    }
  }

  /**
   * 停止输入状态
   */
  stopTyping(): void {
    if (this.typingKeepAlive) {
      this.typingKeepAlive.stop();
      this.typingKeepAlive = null;
    }
  }

  /**
   * 启动连接
   */
  async start(): Promise<void> {
    this.isAborted = false;

    // 注册出站消息 refIdx 缓存钩子
    // 当 bot 发送消息成功且 QQ 返回 ref_idx 时，自动缓存到 ref-index-store
    onMessageSent((refIdx, meta) => {
      console.log(`[gateway:${this.accountId}] onMessageSent: refIdx=${refIdx}`);
      // 缓存 bot 发出的消息，供后续引用
      saveRefIndex(refIdx, {
        content: meta.text ?? "",
        senderId: "bot",
        timestamp: Date.now(),
        isBot: true,
      });
    });

    // 加载持久化数据
    loadRefIndex();
    loadKnownUsers();

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
    // 保存已知用户和引用索引
    flushKnownUsers();
    flushRefIndex();
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
      this.config.log?.error(`[gateway:${this.accountId}] Max reconnect attempts reached or aborted`);
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const delay = customDelay ?? this.getReconnectDelay();
    this.state.reconnectAttempts++;
    this.config.log?.info(`[gateway:${this.accountId}] Reconnecting in ${delay}ms (attempt ${this.state.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isAborted) {
        this.connect();
      }
    }, delay);
  }

  private async connect(): Promise<void> {
    if (this.isConnecting) {
      this.config.log?.debug?.(`[gateway:${this.accountId}] Already connecting, skip`);
      return;
    }
    this.isConnecting = true;

    try {
      this.cleanup();

      if (this.shouldRefreshToken) {
        this.config.log?.info(`[gateway:${this.accountId}] Refreshing token...`);
        clearTokenCache(this.config.appId);
        this.shouldRefreshToken = false;
      }

      // 尝试从持久化存储恢复 Session
      const savedSession = loadSession(this.accountId, this.config.appId);
      if (savedSession) {
        this.state.sessionId = savedSession.sessionId;
        this.state.lastSeq = savedSession.lastSeq;
        this.config.log?.info(`[gateway:${this.accountId}] Restored session: ${this.state.sessionId}, lastSeq=${this.state.lastSeq}`);
      }

      const accessToken = await getAccessToken(this.config.appId, this.config.clientSecret);
      this.config.log?.info(`[gateway:${this.accountId}] Access token obtained successfully`);

      const gatewayUrl = await getGatewayUrl(accessToken);
      this.config.log?.info(`[gateway:${this.accountId}] Connecting to ${gatewayUrl}`);

      const ws = new WebSocket(gatewayUrl, {
        headers: { "User-Agent": PLUGIN_USER_AGENT }
      });
      this.ws = ws;

      ws.on("open", () => {
        this.config.log?.info(`[gateway:${this.accountId}] WebSocket connected`);
        this.isConnecting = false;
        this.state.reconnectAttempts = 0; // 连接成功，重置重试计数
        this.lastConnectTime = Date.now();
      });

      ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(data, accessToken);
      });

      ws.on("close", (code: number, reason: Buffer) => {
        this.config.log?.info(`[gateway:${this.accountId}] WebSocket closed: ${code} ${reason.toString()}`);
        this.state.connected = false;
        this.isConnecting = false;

        // ========== 关键修复：错误码细粒度处理 ==========
        // 4914/4915: 机器人下架/封禁，不重连
        if (code === 4914 || code === 4915) {
          this.config.log?.error(`[gateway:${this.accountId}] Bot is ${code === 4914 ? "offline/sandbox" : "banned"}. Stop reconnecting.`);
          this.cleanup();
          return;
        }

        // 4004: Token 无效，刷新 token 后重连
        if (code === 4004) {
          this.config.log?.info(`[gateway:${this.accountId}] Invalid token (4004), refreshing...`);
          this.shouldRefreshToken = true;
          this.cleanup();
          if (!this.isAborted) this.scheduleReconnect();
          return;
        }

        // 4008: 限流，等待后重连
        if (code === 4008) {
          this.config.log?.info(`[gateway:${this.accountId}] Rate limited (4008), waiting...`);
          this.cleanup();
          if (!this.isAborted) this.scheduleReconnect(RATE_LIMIT_DELAY);
          return;
        }

        // 4006/4007/4009: 会话失效/超时/无效seq，需要清除 session 重新 identify
        if (code === 4006 || code === 4007 || code === 4009) {
          const codeDesc: Record<number, string> = {
            4006: "session no longer valid",
            4007: "invalid seq on resume",
            4009: "session timed out",
          };
          this.config.log?.info(`[gateway:${this.accountId}] ${code} (${codeDesc[code]}), will re-identify`);
          this.state.sessionId = null;
          this.state.lastSeq = null;
          clearSession(this.accountId);
          this.shouldRefreshToken = true;
        } else if (code >= 4900 && code <= 4913) {
          // 4900-4913: 内部错误，清除 session
          this.config.log?.info(`[gateway:${this.accountId}] Internal error (${code}), will re-identify`);
          this.state.sessionId = null;
          this.state.lastSeq = null;
          clearSession(this.accountId);
          this.shouldRefreshToken = true;
        }

        // 检测快速断开
        const connectionDuration = Date.now() - this.lastConnectTime;
        if (connectionDuration < QUICK_DISCONNECT_THRESHOLD && this.lastConnectTime > 0) {
          this.quickDisconnectCount++;
          this.config.log?.info(`[gateway:${this.accountId}] Quick disconnect (${connectionDuration}ms), count: ${this.quickDisconnectCount}`);

          if (this.quickDisconnectCount >= MAX_QUICK_DISCONNECT_COUNT) {
            this.config.log?.error(`[gateway:${this.accountId}] Too many quick disconnects. Check: 1) AppID/Secret correct 2) Bot permissions`);
            this.quickDisconnectCount = 0;
            if (!this.isAborted && code !== 1000) {
              this.scheduleReconnect(RATE_LIMIT_DELAY);
            }
            return;
          }
        } else {
          this.quickDisconnectCount = 0;
        }

        this.cleanup();

        // 非正常关闭则重连
        if (!this.isAborted && code !== 1000) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        this.config.log?.error(`[gateway:${this.accountId}] WebSocket error: ${err.message}`);
        this.config.onError?.(err);
        this.isConnecting = false;
      });

    } catch (err) {
      this.isConnecting = false;
      const errMsg = String(err);
      this.config.log?.error(`[gateway:${this.accountId}] Connection failed: ${err}`);

      if (errMsg.includes("Too many requests") || errMsg.includes("100001")) {
        this.config.log?.info(`[gateway:${this.accountId}] Rate limited, waiting ${RATE_LIMIT_DELAY}ms`);
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
      // 持久化 lastSeq
      if (this.state.sessionId) {
        saveSession({
          sessionId: this.state.sessionId,
          lastSeq: this.state.lastSeq,
          lastConnectedAt: this.lastConnectTime,
          accountId: this.accountId,
          appId: this.config.appId,
          savedAt: Date.now(),
        });
      }
    }

    switch (payload.op) {
      case 10: // Hello
        this.handleHello(payload, accessToken);
        break;
      case 11: // Heartbeat ACK
        this.missedHeartbeats = 0;
        this.state.lastHeartbeat = Date.now();
        this.config.log?.debug?.(`[gateway:${this.accountId}] Heartbeat ACK`);
        break;
      case 1: // Heartbeat from server
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ op: 11, d: payload.d }));
          this.config.log?.debug?.(`[gateway:${this.accountId}] Heartbeat ACK sent`);
        }
        break;
      case 0: // Dispatch
        this.handleDispatch(payload, accessToken);
        break;
      case 9: // Invalid Session
        this.config.log?.error(`[gateway:${this.accountId}] Invalid session`);
        const canResume = payload.d as boolean;
        if (!canResume) {
          this.state.sessionId = null;
          this.state.lastSeq = null;
          clearSession(this.accountId);
        }
        this.shouldRefreshToken = true;
        this.scheduleReconnect(3000);
        break;
      case 7: // Reconnect
        this.config.log?.info(`[gateway:${this.accountId}] Server requested reconnect`);
        this.scheduleReconnect();
        break;
    }
  }

  private handleHello(payload: WSPayload, accessToken: string): void {
    const helloData = payload.d as { heartbeat_interval?: number };
    const heartbeatInterval = helloData?.heartbeat_interval ?? 41250;

    // 开始心跳
    this.missedHeartbeats = 0;
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 1, d: this.state.lastSeq }));
        this.missedHeartbeats++;
        this.config.log?.debug?.(`[gateway:${this.accountId}] Heartbeat sent (missed: ${this.missedHeartbeats}/${HEARTBEAT_MISS_LIMIT})`);

        if (this.missedHeartbeats >= HEARTBEAT_MISS_LIMIT) {
          this.config.log?.error(`[gateway:${this.accountId}] Heartbeat timeout`);
          this.ws.close(4000, "Heartbeat timeout");
        }
      }
    }, heartbeatInterval);

    // 发送 Identify 或 Resume
    if (this.state.sessionId && this.state.lastSeq !== null) {
      this.config.log?.info(`[gateway:${this.accountId}] Attempting to resume session: ${this.state.sessionId}`);
      this.ws?.send(JSON.stringify({
        op: 6, // Resume
        d: {
          token: `QQBot ${accessToken}`,
          session_id: this.state.sessionId,
          seq: this.state.lastSeq,
        }
      }));
    } else {
      this.config.log?.info(`[gateway:${this.accountId}] Sending identify with intents: ${FULL_INTENTS} (${FULL_INTENTS_DESC})`);
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

  private handleDispatch(payload: WSPayload, accessToken: string): void {
    const { t, d } = payload;

    this.config.log?.info(`[gateway:${this.accountId}] 收到事件: ${t}`);
    if (t === "C2C_MESSAGE_CREATE") {
      this.config.log?.info(`[gateway:${this.accountId}] DEBUG C2C raw: ${JSON.stringify(d)}`);
    }

    switch (t) {
      case "READY":
        this.handleReady(d as Record<string, unknown>);
        break;
      case "RESUMED":
        this.config.log?.info(`[gateway:${this.accountId}] Session resumed`);
        this.state.connected = true;
        // 保存恢复的 session
        if (this.state.sessionId) {
          saveSession({
            sessionId: this.state.sessionId,
            lastSeq: this.state.lastSeq,
            lastConnectedAt: Date.now(),
            accountId: this.accountId,
            appId: this.config.appId,
            savedAt: Date.now(),
          });
        }
        this.config.onReady?.();
        break;
      case "C2C_MESSAGE_CREATE":
        this.handleC2CMessage(d as C2CMessageEvent, accessToken);
        break;
      case "GROUP_AT_MESSAGE_CREATE":
        this.handleGroupMessage(d as GroupMessageEvent, accessToken);
        break;
      case "AT_MESSAGE_CREATE":
        this.handleGuildMessage(d as GuildMessageEvent, accessToken);
        break;
      case "DIRECT_MESSAGE_CREATE":
        // 频道私信，暂当作 C2C 处理
        this.handleDirectMessage(d as GuildMessageEvent, accessToken);
        break;
      default:
        this.config.log?.debug?.(`[gateway:${this.accountId}] 未处理的事件: ${t}`);
    }
  }

  private handleReady(data: Record<string, unknown>): void {
    this.state.sessionId = data.session_id as string;
    this.state.connected = true;
    this.state.reconnectAttempts = 0;

    // 保存新 session
    saveSession({
      sessionId: this.state.sessionId,
      lastSeq: this.state.lastSeq,
      lastConnectedAt: Date.now(),
      accountId: this.accountId,
      appId: this.config.appId,
      savedAt: Date.now(),
    });

    this.config.log?.info(`[gateway:${this.accountId}] Gateway ready, session: ${this.state.sessionId}`);
    this.config.onReady?.();
  }

  private async handleC2CMessage(event: C2CMessageEvent, accessToken: string): Promise<void> {
    // 记录已知用户
    recordKnownUser({
      openid: event.author.user_openid,
      type: "c2c",
      accountId: this.accountId,
    });

    // 解析引用消息
    const refs = parseRefIndices(event.message_scene?.ext);
    let replyToBody: string | undefined;
    let replyToSender: string | undefined;
    let replyToIsQuote = false;

    // DEBUG: 打印原始 message_scene
    this.config.log?.info(`[gateway:${this.accountId}] DEBUG message_scene: ${JSON.stringify(event.message_scene)}`);
    this.config.log?.info(`[gateway:${this.accountId}] DEBUG raw event keys: ${Object.keys(event).join(", ")}`);

    if (refs.refMsgIdx) {
      const refEntry = getRefIndex(refs.refMsgIdx);
      if (refEntry) {
        replyToBody = refEntry.content;
        replyToSender = refEntry.senderName || refEntry.senderId;
        replyToIsQuote = true;
        this.config.log?.info(`[gateway:${this.accountId}] Quote: ${refs.refMsgIdx} -> "${replyToBody?.slice(0, 50)}..."`);
      }
    }

    // 缓存当前消息的 msgIdx（供将来被引用）
    if (refs.msgIdx) {
      saveRefIndex(refs.msgIdx, {
        content: event.content,
        senderId: event.author.user_openid,
        senderName: event.author.user_openid,
        timestamp: Date.now(),
        isBot: false,
      });
    }

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
      // 引用消息
      ...(replyToIsQuote ? {
        quote: {
          id: refs.refMsgIdx!,
          content: replyToBody,
          senderName: replyToSender,
        }
      } : {}),
      // 原始 refMsgIdx，供 HTTP API 发送引用回复用
      ...(refs.refMsgIdx ? { refMsgIdx: refs.refMsgIdx } : {}),
    };
    this.emitMessage(message);
  }

  private async handleGroupMessage(event: GroupMessageEvent, accessToken: string): Promise<void> {
    // 记录已知用户
    recordKnownUser({
      openid: event.author.member_openid,
      type: "group",
      groupOpenid: event.group_openid,
      accountId: this.accountId,
    });

    // 解析引用消息
    const refs = parseRefIndices(event.message_scene?.ext);
    let replyToBody: string | undefined;
    let replyToSender: string | undefined;
    let replyToIsQuote = false;

    if (refs.refMsgIdx) {
      const refEntry = getRefIndex(refs.refMsgIdx);
      if (refEntry) {
        replyToBody = refEntry.content;
        replyToSender = refEntry.senderName || refEntry.senderId;
        replyToIsQuote = true;
      }
    }

    // 缓存当前消息的 msgIdx
    if (refs.msgIdx) {
      saveRefIndex(refs.msgIdx, {
        content: event.content,
        senderId: event.author.member_openid,
        timestamp: Date.now(),
        isBot: false,
      });
    }

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
      ...(replyToIsQuote ? {
        quote: {
          id: refs.refMsgIdx!,
          content: replyToBody,
          senderName: replyToSender,
        }
      } : {}),
      ...(refs.refMsgIdx ? { refMsgIdx: refs.refMsgIdx } : {}),
    };
    this.emitMessage(message);
  }

  private async handleGuildMessage(event: GuildMessageEvent, accessToken: string): Promise<void> {
    // 记录已知用户
    recordKnownUser({
      openid: event.author.id,
      type: "c2c",
      nickname: event.author.username,
      accountId: this.accountId,
    });

    // 解析引用消息
    const refs = parseRefIndices((event as any).message_scene?.ext);
    let replyToBody: string | undefined;
    let replyToSender: string | undefined;
    let replyToIsQuote = false;

    if (refs.refMsgIdx) {
      const refEntry = getRefIndex(refs.refMsgIdx);
      if (refEntry) {
        replyToBody = refEntry.content;
        replyToSender = refEntry.senderName || refEntry.senderId;
        replyToIsQuote = true;
      }
    }

    // 缓存当前消息的 msgIdx
    if (refs.msgIdx) {
      saveRefIndex(refs.msgIdx, {
        content: event.content,
        senderId: event.author.id,
        senderName: event.author.username,
        timestamp: Date.now(),
        isBot: false,
      });
    }

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
      ...(replyToIsQuote ? {
        quote: {
          id: refs.refMsgIdx!,
          content: replyToBody,
          senderName: replyToSender,
        }
      } : {}),
    };
    this.emitMessage(message);
  }

  private async handleDirectMessage(event: GuildMessageEvent, accessToken: string): Promise<void> {
    // 频道私信当作 C2C 处理
    recordKnownUser({
      openid: event.author.id,
      type: "c2c",
      nickname: event.author.username,
      accountId: this.accountId,
    });

    const message: PushedMessage = {
      type: "c2c",
      sender: {
        id: event.author.id,
        openid: event.author.id,
        nickname: event.author.username,
      },
      content: event.content,
      messageId: event.id,
      timestamp: parseInt(event.timestamp) * 1000,
      attachments: event.attachments,
    };
    this.emitMessage(message);
  }
}
