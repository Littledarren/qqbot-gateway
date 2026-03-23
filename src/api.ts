/**
 * QQ Bot API 鉴权和请求封装
 * 独立版本，无 OpenClaw 依赖
 */
import os from "node:os";
import { computeFileHash } from "./utils/file-utils.js";
import { sanitizeFileName } from "./utils/platform.js";

const API_BASE = "https://api.sgroup.qq.com";
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";

// Plugin User-Agent
const PLUGIN_VERSION = "1.0.0";
export const PLUGIN_USER_AGENT = `QQBotGateway/${PLUGIN_VERSION} (Node/${process.versions.node}; ${os.platform()})`;

// Token 缓存
const tokenCacheMap = new Map<string, { token: string; expiresAt: number; appId: string }>();
const tokenFetchPromises = new Map<string, Promise<string>>();

// 上传缓存
const uploadCache = new Map<string, { fileInfo: string; fileUuid: string; expiresAt: number }>();

// ============ API 配置 ============

let currentMarkdownSupport = false;

/**
 * 初始化 API 配置
 * @param options.markdownSupport - 是否支持 markdown 消息（默认 false，需要机器人具备该权限才能启用）
 * - Markdown OFF: msg_type=0, content=string
 * - Markdown ON:  msg_type=2, markdown={ content: string }
 */
export function initApiConfig(options: { markdownSupport?: boolean }): void {
  currentMarkdownSupport = options.markdownSupport === true;
}

// ============ 出站消息回调钩子 ============

/** 出站消息元信息 */
export interface OutboundMeta {
  text?: string;
  mediaType?: string;
  mediaUrl?: string;
  mediaLocalPath?: string;
  ttsText?: string;
}

type OnMessageSentCallback = (refIdx: string, meta: OutboundMeta) => void;
let onMessageSentHook: OnMessageSentCallback | null = null;

/**
 * 注册出站消息回调
 * 当消息发送成功且 QQ 返回 ref_idx 时，自动回调此函数
 * 用于在最底层统一缓存 bot 出站消息的 refIdx
 */
export function onMessageSent(callback: OnMessageSentCallback): void {
  onMessageSentHook = callback;
}

/**
 * 获取 AccessToken（带缓存 + singleflight）
 */
export async function getAccessToken(appId: string, clientSecret: string): Promise<string> {
  const normalizedAppId = String(appId).trim();
  const cachedToken = tokenCacheMap.get(normalizedAppId);

  const REFRESH_AHEAD_MS = cachedToken
    ? Math.min(5 * 60 * 1000, (cachedToken.expiresAt - Date.now()) / 3)
    : 0;

  if (cachedToken && Date.now() < cachedToken.expiresAt - REFRESH_AHEAD_MS) {
    return cachedToken.token;
  }

  let fetchPromise = tokenFetchPromises.get(normalizedAppId);
  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      return await doFetchToken(normalizedAppId, clientSecret);
    } finally {
      tokenFetchPromises.delete(normalizedAppId);
    }
  })();

  tokenFetchPromises.set(normalizedAppId, fetchPromise);
  return fetchPromise;
}

async function doFetchToken(appId: string, clientSecret: string): Promise<string> {
  const requestBody = { appId, clientSecret };
  const requestHeaders = {
    "Content-Type": "application/json",
    "User-Agent": PLUGIN_USER_AGENT
  };

  console.log(`[qqbot-api:${appId}] >>> POST ${TOKEN_URL}`);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(requestBody),
  });

  const data = await response.json() as { access_token?: string; expires_in?: number };

  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to get access_token: ${JSON.stringify(data)}`);
  }

  const expiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
  tokenCacheMap.set(appId, {
    token: data.access_token,
    expiresAt,
    appId,
  });

  console.log(`[qqbot-api:${appId}] Token cached, expires at: ${new Date(expiresAt).toISOString()}`);
  return data.access_token;
}

/**
 * 清除 Token 缓存
 */
export function clearTokenCache(appId?: string): void {
  if (appId) {
    tokenCacheMap.delete(String(appId).trim());
  } else {
    tokenCacheMap.clear();
  }
}

/**
 * 获取全局唯一的消息序号
 */
export function getNextMsgSeq(_msgId: string): number {
  const timePart = Date.now() % 100000000;
  const random = Math.floor(Math.random() * 65536);
  return (timePart ^ random) % 65536;
}

// API 请求超时配置
const DEFAULT_API_TIMEOUT = 30000;
const FILE_UPLOAD_TIMEOUT = 120000;

/**
 * API 请求封装
 */
export async function apiRequest<T>(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `QQBot ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": PLUGIN_USER_AGENT,
  };

  const isFileUpload = path.includes("/files");
  const timeout = timeoutMs ?? (isFileUpload ? FILE_UPLOAD_TIMEOUT : DEFAULT_API_TIMEOUT);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const options: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  console.log(`[qqbot-api] >>> ${method} ${url}`);

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(`Network error [${path}]: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const traceId = res.headers.get("x-tps-trace-id") ?? "";
  console.log(`[qqbot-api] <<< Status: ${res.status}${traceId ? ` | TraceId: ${traceId}` : ""}`);

  let data: T;
  try {
    data = await res.json() as T;
  } catch (err) {
    throw new Error(`Failed to parse response[${path}]`);
  }

  if (!res.ok) {
    const error = data as { message?: string; code?: number };
    throw new Error(`API Error [${path}]: ${error.message ?? JSON.stringify(data)}`);
  }

  return data;
}

/**
 * 获取 Gateway URL
 */
export async function getGatewayUrl(accessToken: string): Promise<string> {
  const data = await apiRequest<{ url: string }>(accessToken, "GET", "/gateway");
  return data.url;
}

// ============ 用户信息 ============

export interface C2CUserInfo {
  openid: string;
  nickname?: string;
  // 可能还有其他字段
}

/**
 * 获取 C2C 用户详情
 */
export async function getC2CUserInfo(
  accessToken: string,
  openid: string
): Promise<C2CUserInfo> {
  return apiRequest<C2CUserInfo>(accessToken, "GET", `/v2/users/${openid}/profile`);
}

// ============ 消息发送接口 ============

export interface MessageResponse {
  id: string;
  timestamp: number | string;
  ext_info?: {
    ref_idx?: string;
  };
}

/**
 * 发送 C2C 输入状态通知
 */
export async function sendC2CInputNotify(
  accessToken: string,
  openid: string,
  msgId?: string,
  inputSecond: number = 60
): Promise<{ refIdx?: string }> {
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1;
  const body = {
    msg_type: 6,
    input_notify: {
      input_type: 1,
      input_second: inputSecond,
    },
    msg_seq: msgSeq,
    ...(msgId ? { msg_id: msgId } : {}),
  };
  const response = await apiRequest<{ ext_info?: { ref_idx?: string } }>(accessToken, "POST", `/v2/users/${openid}/messages`, body);
  return { refIdx: response.ext_info?.ref_idx };
}

/**
 * 构建消息体（支持 Markdown 和 messageReference）
 */
function buildMessageBody(
  content: string,
  msgId: string | undefined,
  msgSeq: number,
  messageReference?: string
): Record<string, unknown> {
  const body: Record<string, unknown> = currentMarkdownSupport
    ? {
        msg_type: 2,
        markdown: { content },
        msg_seq: msgSeq,
      }
    : {
        content,
        msg_type: 0,
        msg_seq: msgSeq,
      };

  if (msgId) {
    body.msg_id = msgId;
  }
  if (messageReference && !currentMarkdownSupport) {
    body.message_reference = { message_id: messageReference };
  }
  return body;
}

/**
 * 发送 C2C 消息
 * @param messageReference - 引用消息的 message_id（设置后为引用回复样式，仅非 Markdown 模式支持）
 */
export async function sendC2CMessage(
  accessToken: string,
  openid: string,
  content: string,
  msgId?: string,
  messageReference?: string
): Promise<MessageResponse> {
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1;
  const body = buildMessageBody(content, msgId, msgSeq, messageReference);
  const result = await apiRequest<MessageResponse>(accessToken, "POST", `/v2/users/${openid}/messages`, body);
  // 触发 refIdx 缓存钩子
  if (result.ext_info?.ref_idx && onMessageSentHook) {
    try {
      onMessageSentHook(result.ext_info.ref_idx, { text: content });
    } catch (err) {
      console.error(`[qqbot-api] onMessageSent hook error: ${err}`);
    }
  }
  return result;
}

/**
 * 发送群消息
 * @param messageReference - 引用消息的 message_id（设置后为引用回复样式，仅非 Markdown 模式支持）
 */
export async function sendGroupMessage(
  accessToken: string,
  groupOpenid: string,
  content: string,
  msgId?: string,
  messageReference?: string
): Promise<MessageResponse> {
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1;
  const body = buildMessageBody(content, msgId, msgSeq, messageReference);
  const result = await apiRequest<MessageResponse>(accessToken, "POST", `/v2/groups/${groupOpenid}/messages`, body);
  if (result.ext_info?.ref_idx && onMessageSentHook) {
    try {
      onMessageSentHook(result.ext_info.ref_idx, { text: content });
    } catch (err) {
      console.error(`[qqbot-api] onMessageSent hook error: ${err}`);
    }
  }
  return result;
}

/**
 * 发送频道消息
 */
export async function sendChannelMessage(
  accessToken: string,
  channelId: string,
  content: string,
  msgId?: string
): Promise<{ id: string; timestamp: string }> {
  return apiRequest(accessToken, "POST", `/channels/${channelId}/messages`, {
    content,
    ...(msgId ? { msg_id: msgId } : {}),
  });
}

/**
 * 发送主动 C2C 消息（无 msgId）
 * 尊重 initApiConfig 的 markdownSupport 设置
 */
export async function sendProactiveC2CMessage(
  accessToken: string,
  openid: string,
  content: string
): Promise<MessageResponse> {
  const body = buildMessageBody(content, undefined, 1);
  return apiRequest<MessageResponse>(accessToken, "POST", `/v2/users/${openid}/messages`, body);
}

/**
 * 发送主动群消息（无 msgId）
 * 尊重 initApiConfig 的 markdownSupport 设置
 */
export async function sendProactiveGroupMessage(
  accessToken: string,
  groupOpenid: string,
  content: string
): Promise<MessageResponse> {
  const body = buildMessageBody(content, undefined, 1);
  return apiRequest<MessageResponse>(accessToken, "POST", `/v2/groups/${groupOpenid}/messages`, body);
}

// ============ 富媒体消息支持 ============

export enum MediaFileType {
  IMAGE = 1,
  VIDEO = 2,
  VOICE = 3,
  FILE = 4,
}

export interface UploadMediaResponse {
  file_uuid: string;
  file_info: string;
  ttl: number;
  id?: string;
}

/**
 * 上传 C2C 媒体文件
 */
export async function uploadC2CMedia(
  accessToken: string,
  openid: string,
  fileType: MediaFileType,
  url?: string,
  fileData?: string,
  srvSendMsg = false,
  fileName?: string,
): Promise<UploadMediaResponse> {
  if (!url && !fileData) throw new Error("uploadC2CMedia: url or fileData is required");

  // 检查缓存
  if (fileData) {
    const contentHash = computeFileHash(fileData);
    const cacheKey = `c2c:${openid}:${fileType}:${contentHash}`;
    const cached = uploadCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { file_uuid: cached.fileUuid, file_info: cached.fileInfo, ttl: 0 };
    }
  }

  const body: Record<string, unknown> = { file_type: fileType, srv_send_msg: srvSendMsg };
  if (url) body.url = url;
  else if (fileData) body.file_data = fileData;
  if (fileType === MediaFileType.FILE && fileName) body.file_name = sanitizeFileName(fileName);

  const result = await apiRequestWithRetry<UploadMediaResponse>(
    accessToken,
    "POST",
    `/v2/users/${openid}/files`,
    body
  );

  // 缓存结果
  if (fileData && result.file_info && result.ttl > 0) {
    const contentHash = computeFileHash(fileData);
    const cacheKey = `c2c:${openid}:${fileType}:${contentHash}`;
    uploadCache.set(cacheKey, {
      fileInfo: result.file_info,
      fileUuid: result.file_uuid,
      expiresAt: Date.now() + result.ttl * 1000,
    });
  }

  return result;
}

/**
 * 上传群媒体文件
 */
export async function uploadGroupMedia(
  accessToken: string,
  groupOpenid: string,
  fileType: MediaFileType,
  url?: string,
  fileData?: string,
  srvSendMsg = false,
  fileName?: string,
): Promise<UploadMediaResponse> {
  if (!url && !fileData) throw new Error("uploadGroupMedia: url or fileData is required");

  // 检查缓存
  if (fileData) {
    const contentHash = computeFileHash(fileData);
    const cacheKey = `group:${groupOpenid}:${fileType}:${contentHash}`;
    const cached = uploadCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { file_uuid: cached.fileUuid, file_info: cached.fileInfo, ttl: 0 };
    }
  }

  const body: Record<string, unknown> = { file_type: fileType, srv_send_msg: srvSendMsg };
  if (url) body.url = url;
  else if (fileData) body.file_data = fileData;
  if (fileType === MediaFileType.FILE && fileName) body.file_name = sanitizeFileName(fileName);

  const result = await apiRequestWithRetry<UploadMediaResponse>(
    accessToken,
    "POST",
    `/v2/groups/${groupOpenid}/files`,
    body
  );

  // 缓存结果
  if (fileData && result.file_info && result.ttl > 0) {
    const contentHash = computeFileHash(fileData);
    const cacheKey = `group:${groupOpenid}:${fileType}:${contentHash}`;
    uploadCache.set(cacheKey, {
      fileInfo: result.file_info,
      fileUuid: result.file_uuid,
      expiresAt: Date.now() + result.ttl * 1000,
    });
  }

  return result;
}

/**
 * 带重试的 API 请求
 */
async function apiRequestWithRetry<T>(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiRequest<T>(accessToken, method, path, body);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errMsg = lastError.message;

      // 不重试的错误（直接失败，不值得等待重试）
      if (errMsg.includes("400") || errMsg.includes("401") || errMsg.includes("Invalid")) {
        throw lastError;
      }
      // 22009: 消息频率超限，不重试
      if (errMsg.includes("22009")) {
        throw lastError;
      }
      // upload timeout 不重试
      if (errMsg.includes("upload timeout") || errMsg.includes("timeout")) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`[qqbot-api] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

/**
 * 发送 C2C 媒体消息
 */
export async function sendC2CMediaMessage(
  accessToken: string,
  openid: string,
  fileInfo: string,
  msgId?: string,
  content?: string,
): Promise<MessageResponse> {
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1;
  return apiRequest<MessageResponse>(accessToken, "POST", `/v2/users/${openid}/messages`, {
    msg_type: 7,
    media: { file_info: fileInfo },
    msg_seq: msgSeq,
    ...(content ? { content } : {}),
    ...(msgId ? { msg_id: msgId } : {}),
  });
}

/**
 * 发送群媒体消息
 */
export async function sendGroupMediaMessage(
  accessToken: string,
  groupOpenid: string,
  fileInfo: string,
  msgId?: string,
  content?: string
): Promise<MessageResponse> {
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1;
  return apiRequest<MessageResponse>(accessToken, "POST", `/v2/groups/${groupOpenid}/messages`, {
    msg_type: 7,
    media: { file_info: fileInfo },
    msg_seq: msgSeq,
    ...(content ? { content } : {}),
    ...(msgId ? { msg_id: msgId } : {}),
  });
}

/**
 * 发送 C2C 图片消息
 */
export async function sendC2CImageMessage(
  accessToken: string,
  openid: string,
  imageUrl: string,
  msgId?: string,
  content?: string
): Promise<MessageResponse> {
  const isBase64 = imageUrl.startsWith("data:");
  let uploadResult: UploadMediaResponse;

  if (isBase64) {
    const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error("Invalid Base64 Data URL format");
    uploadResult = await uploadC2CMedia(accessToken, openid, MediaFileType.IMAGE, undefined, matches[2], false);
  } else {
    uploadResult = await uploadC2CMedia(accessToken, openid, MediaFileType.IMAGE, imageUrl, undefined, false);
  }

  return sendC2CMediaMessage(accessToken, openid, uploadResult.file_info, msgId, content);
}

/**
 * 发送群图片消息
 */
export async function sendGroupImageMessage(
  accessToken: string,
  groupOpenid: string,
  imageUrl: string,
  msgId?: string,
  content?: string
): Promise<MessageResponse> {
  const isBase64 = imageUrl.startsWith("data:");
  let uploadResult: UploadMediaResponse;

  if (isBase64) {
    const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error("Invalid Base64 Data URL format");
    uploadResult = await uploadGroupMedia(accessToken, groupOpenid, MediaFileType.IMAGE, undefined, matches[2], false);
  } else {
    uploadResult = await uploadGroupMedia(accessToken, groupOpenid, MediaFileType.IMAGE, imageUrl, undefined, false);
  }

  return sendGroupMediaMessage(accessToken, groupOpenid, uploadResult.file_info, msgId, content);
}

/**
 * 发送 C2C 语音消息
 */
export async function sendC2CVoiceMessage(
  accessToken: string,
  openid: string,
  voiceUrl?: string,
  voiceBase64?: string,
  msgId?: string
): Promise<MessageResponse> {
  const uploadResult = await uploadC2CMedia(accessToken, openid, MediaFileType.VOICE, voiceUrl, voiceBase64, false);
  return sendC2CMediaMessage(accessToken, openid, uploadResult.file_info, msgId);
}

/**
 * 发送群语音消息
 */
export async function sendGroupVoiceMessage(
  accessToken: string,
  groupOpenid: string,
  voiceUrl?: string,
  voiceBase64?: string,
  msgId?: string
): Promise<MessageResponse> {
  const uploadResult = await uploadGroupMedia(accessToken, groupOpenid, MediaFileType.VOICE, voiceUrl, voiceBase64, false);
  return sendGroupMediaMessage(accessToken, groupOpenid, uploadResult.file_info, msgId);
}

/**
 * 发送 C2C 文件消息
 */
export async function sendC2CFileMessage(
  accessToken: string,
  openid: string,
  fileUrl?: string,
  fileBase64?: string,
  msgId?: string,
  fileName?: string
): Promise<MessageResponse> {
  const uploadResult = await uploadC2CMedia(accessToken, openid, MediaFileType.FILE, fileUrl, fileBase64, false, fileName);
  return sendC2CMediaMessage(accessToken, openid, uploadResult.file_info, msgId);
}

/**
 * 发送群文件消息
 */
export async function sendGroupFileMessage(
  accessToken: string,
  groupOpenid: string,
  fileUrl?: string,
  fileBase64?: string,
  msgId?: string,
  fileName?: string
): Promise<MessageResponse> {
  const uploadResult = await uploadGroupMedia(accessToken, groupOpenid, MediaFileType.FILE, fileUrl, fileBase64, false, fileName);
  return sendGroupMediaMessage(accessToken, groupOpenid, uploadResult.file_info, msgId);
}

// ============ 视频消息 ============

/**
 * 发送 C2C 视频消息
 */
export async function sendC2CVideoMessage(
  accessToken: string,
  openid: string,
  videoUrl?: string,
  videoBase64?: string,
  msgId?: string
): Promise<MessageResponse> {
  const uploadResult = await uploadC2CMedia(accessToken, openid, MediaFileType.VIDEO, videoUrl, videoBase64, false);
  return sendC2CMediaMessage(accessToken, openid, uploadResult.file_info, msgId);
}

/**
 * 发送群视频消息
 */
export async function sendGroupVideoMessage(
  accessToken: string,
  groupOpenid: string,
  videoUrl?: string,
  videoBase64?: string,
  msgId?: string
): Promise<MessageResponse> {
  const uploadResult = await uploadGroupMedia(accessToken, groupOpenid, MediaFileType.VIDEO, videoUrl, videoBase64, false);
  return sendGroupMediaMessage(accessToken, groupOpenid, uploadResult.file_info, msgId);
}
