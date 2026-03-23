/**
 * HTTP API 服务 - 基于 Hono
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { WebSocket as WSWebSocket } from "ws";
import type {
  SendTextRequest,
  SendImageRequest,
  SendVoiceRequest,
  SendFileRequest,
  ApiResponse,
  SendResponse,
  StatusResponse,
  PushedMessage,
} from "./types.js";
import {
  getAccessToken,
  sendProactiveC2CMessage,
  sendProactiveGroupMessage,
  sendC2CMessage,
  sendC2CImageMessage,
  sendGroupImageMessage,
  sendC2CVoiceMessage,
  sendGroupVoiceMessage,
  sendC2CFileMessage,
  sendGroupFileMessage,
  initApiConfig,
} from "./api.js";
import type { QQBotGateway } from "./gateway.js";

export interface HttpServerConfig {
  port: number;
  gateway: QQBotGateway;
  appId: string;
  clientSecret: string;
}

/**
 * 创建 HTTP 服务器
 */
export function createHttpServer(config: HttpServerConfig): { app: Hono; start: () => void } {
  const { port, gateway, appId, clientSecret } = config;
  const app = new Hono();

  // CORS 支持
  app.use("*", cors());

  // WebSocket 支持（用于推送消息给客户端）
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // 存储连接的客户端
  const wsClients = new Set<WSWebSocket>();

  // 注册消息回调，收到 QQ 消息时推送给所有客户端
  gateway.onMessage((message: PushedMessage) => {
    const messageStr = JSON.stringify(message);
    for (const client of wsClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(messageStr);
      }
    }
  });

  // WebSocket 端点
  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        const rawWs = ws.raw as unknown as WSWebSocket;
        if (rawWs) {
          wsClients.add(rawWs);
          console.log(`[http] WebSocket client connected, total: ${wsClients.size}`);
        }
      },
      onClose(_evt, ws) {
        const rawWs = ws.raw as unknown as WSWebSocket;
        if (rawWs) {
          wsClients.delete(rawWs);
          console.log(`[http] WebSocket client disconnected, total: ${wsClients.size}`);
        }
      },
    }))
  );

  // ============ API 路由 ============

  // 获取状态
  app.get("/api/status", (c) => {
    const state = gateway.getState();
    const response: ApiResponse<StatusResponse> = {
      success: true,
      data: {
        connected: state.connected,
        sessionId: state.sessionId ?? undefined,
        lastHeartbeat: state.lastHeartbeat ?? undefined,
      },
    };
    return c.json(response);
  });

  // 发送 Markdown 测试消息
  app.post("/api/send/markdown", async (c) => {
    try {
      const body = await c.req.json<{ to: string; content: string; msgId?: string }>();

      if (!body.to || !body.content) {
        return c.json<ApiResponse>({ success: false, error: "Missing 'to' or 'content'" }, 400);
      }

      // 启用 markdown 模式
      initApiConfig({ markdownSupport: true });

      const accessToken = await getAccessToken(appId, clientSecret);
      let result;

      try {
        if (body.msgId) {
          result = await sendC2CMessage(accessToken, body.to, body.content, body.msgId);
        } else {
          result = await sendProactiveC2CMessage(accessToken, body.to, body.content);
        }
      } finally {
        // 恢复文本模式
        initApiConfig({ markdownSupport: false });
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
      initApiConfig({ markdownSupport: false });
      return c.json<ApiResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // 发送文本消息
  app.post("/api/send", async (c) => {
    try {
      const body = await c.req.json<SendTextRequest>();

      if (!body.to || !body.content) {
        return c.json<ApiResponse>({ success: false, error: "Missing 'to' or 'content'" }, 400);
      }

      const accessToken = await getAccessToken(appId, clientSecret);
      const type = body.type || "c2c";

      let result;

      // C2C 消息发送前启动 typing 状态
      if (type !== "group") {
        gateway.startTyping(body.to, body.msgId);
      }

      try {
        if (type === "group") {
          // 群消息暂不支持 msgId 回复
          result = await sendProactiveGroupMessage(accessToken, body.to, body.content);
        } else {
          // 如果提供 msgId，则作为回复发送；否则为主动推送
          if (body.msgId) {
            console.log(`[http] Sending reply to msgId: ${body.msgId}`);
            // messageReference 用于引用消息样式（REFIDX），msgId 用于被动回复
            result = await sendC2CMessage(accessToken, body.to, body.content, body.msgId, body.messageReference);
          } else {
            result = await sendProactiveC2CMessage(accessToken, body.to, body.content);
          }
        }
      } finally {
        // 发送完成后停止 typing
        gateway.stopTyping();
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
      gateway.stopTyping();
      return c.json<ApiResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // 发送图片
  app.post("/api/send/image", async (c) => {
    try {
      const body = await c.req.json<SendImageRequest>();

      if (!body.to || !body.imageUrl) {
        return c.json<ApiResponse>({ success: false, error: "Missing 'to' or 'imageUrl'" }, 400);
      }

      const accessToken = await getAccessToken(appId, clientSecret);
      const type = body.type || "c2c";

      let result;

      // C2C 消息发送前启动 typing 状态
      if (type !== "group") {
        gateway.startTyping(body.to);
      }

      try {
        if (type === "group") {
          result = await sendGroupImageMessage(accessToken, body.to, body.imageUrl, undefined, body.content);
        } else {
          result = await sendC2CImageMessage(accessToken, body.to, body.imageUrl, undefined, body.content);
        }
      } finally {
        gateway.stopTyping();
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
      gateway.stopTyping();
      return c.json<ApiResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // 发送语音
  app.post("/api/send/voice", async (c) => {
    try {
      const body = await c.req.json<SendVoiceRequest>();

      if (!body.to || !body.voiceUrl) {
        return c.json<ApiResponse>({ success: false, error: "Missing 'to' or 'voiceUrl'" }, 400);
      }

      const accessToken = await getAccessToken(appId, clientSecret);
      const type = body.type || "c2c";

      let result;

      // C2C 消息发送前启动 typing 状态
      if (type !== "group") {
        gateway.startTyping(body.to);
      }

      try {
        if (type === "group") {
          result = await sendGroupVoiceMessage(accessToken, body.to, body.voiceUrl);
        } else {
          result = await sendC2CVoiceMessage(accessToken, body.to, body.voiceUrl);
        }
      } finally {
        gateway.stopTyping();
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
      gateway.stopTyping();
      return c.json<ApiResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // 发送文件
  app.post("/api/send/file", async (c) => {
    try {
      const body = await c.req.json<SendFileRequest>();

      if (!body.to || !body.fileUrl) {
        return c.json<ApiResponse>({ success: false, error: "Missing 'to' or 'fileUrl'" }, 400);
      }

      const accessToken = await getAccessToken(appId, clientSecret);
      const type = body.type || "c2c";

      let result;

      // C2C 消息发送前启动 typing 状态
      if (type !== "group") {
        gateway.startTyping(body.to);
      }

      try {
        if (type === "group") {
          result = await sendGroupFileMessage(accessToken, body.to, body.fileUrl, undefined, undefined, body.fileName);
        } else {
          result = await sendC2CFileMessage(accessToken, body.to, body.fileUrl, undefined, undefined, body.fileName);
        }
      } finally {
        gateway.stopTyping();
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
      gateway.stopTyping();
      return c.json<ApiResponse>(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  });

  // 健康检查
  app.get("/health", (c) => c.json({ status: "ok" }));

  const start = () => {
    const server = serve({
      fetch: app.fetch,
      port,
      hostname: "127.0.0.1",
    });
    injectWebSocket(server);
    console.log(`[http] Server started on port ${port}`);
    console.log(`[http] WebSocket endpoint: ws://localhost:${port}/ws`);
    console.log(`[http] API endpoints:`);
    console.log(`[http]   GET  /api/status`);
    console.log(`[http]   POST /api/send`);
    console.log(`[http]   POST /api/send/image`);
    console.log(`[http]   POST /api/send/voice`);
    console.log(`[http]   POST /api/send/file`);
  };

  return { app, start };
}
