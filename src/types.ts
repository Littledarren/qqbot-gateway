/**
 * QQ Bot 类型定义
 */

/**
 * QQ Bot 配置
 */
export interface QQBotConfig {
  appId: string;
  clientSecret: string;
}

/**
 * 富媒体附件
 */
export interface MessageAttachment {
  content_type: string;
  filename?: string;
  height?: number;
  width?: number;
  size?: number;
  url: string;
  voice_wav_url?: string;
  asr_refer_text?: string;
}

/**
 * C2C 消息事件
 */
export interface C2CMessageEvent {
  author: {
    id: string;
    union_openid: string;
    user_openid: string;
  };
  content: string;
  id: string;
  timestamp: string;
  message_scene?: {
    source: string;
    ext?: string[];
  };
  attachments?: MessageAttachment[];
}

/**
 * 频道 AT 消息事件
 */
export interface GuildMessageEvent {
  id: string;
  channel_id: string;
  guild_id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username?: string;
    bot?: boolean;
  };
  member?: {
    nick?: string;
    joined_at?: string;
  };
  attachments?: MessageAttachment[];
}

/**
 * 群聊 AT 消息事件
 */
export interface GroupMessageEvent {
  author: {
    id: string;
    member_openid: string;
  };
  content: string;
  id: string;
  timestamp: string;
  group_id: string;
  group_openid: string;
  message_scene?: {
    source: string;
    ext?: string[];
  };
  attachments?: MessageAttachment[];
}

/**
 * WebSocket 事件负载
 */
export interface WSPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

/**
 * 引用消息
 */
export interface QuoteInfo {
  id: string;
  content?: string;
  senderName?: string;
}

/**
 * 推送给客户端的消息格式
 */
export interface PushedMessage {
  type: "c2c" | "group" | "channel";
  sender: {
    id: string;
    openid: string;
    nickname?: string;
  };
  content: string;
  messageId: string;
  timestamp: number;
  channelId?: string;
  guildId?: string;
  groupOpenid?: string;
  attachments?: MessageAttachment[];
  /** 引用消息信息 */
  quote?: QuoteInfo;
  /** 引用消息的 refIdx（用于发送引用回复） */
  refMsgIdx?: string;
}

/**
 * HTTP API 请求类型
 */
export interface SendTextRequest {
  to: string;
  type: "c2c" | "group";
  content: string;
  msgId?: string;  // 如果提供 msgId，则作为回复发送
  messageReference?: string;  // 引用消息 ID（设置后为引用回复样式）
  refMsgIdx?: string;  // 被引用的消息 refIdx（从 PushedMessage.refMsgIdx 获取，用于发送引用回复）
}

export interface SendImageRequest {
  to: string;
  type: "c2c" | "group";
  imageUrl: string;
  content?: string;
  msgId?: string;  // 如果提供 msgId，则作为回复发送
}

export interface SendVoiceRequest {
  to: string;
  type: "c2c" | "group";
  voiceUrl: string;
  msgId?: string;  // 如果提供 msgId，则作为回复发送
}

export interface SendFileRequest {
  to: string;
  type: "c2c" | "group";
  fileUrl: string;
  fileName?: string;
  msgId?: string;  // 如果提供 msgId，则作为回复发送
}

/**
 * HTTP API 响应类型
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SendResponse {
  messageId: string;
  timestamp: number | string;
}

export interface StatusResponse {
  connected: boolean;
  sessionId?: string;
  lastHeartbeat?: number;
}

/**
 * Gateway 状态
 */
export interface GatewayState {
  connected: boolean;
  sessionId: string | null;
  lastSeq: number | null;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
}
