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
  sendC2CImageMessage,
  sendGroupImageMessage,
  sendC2CVoiceMessage,
  sendGroupVoiceMessage,
  sendC2CFileMessage,
  sendGroupFileMessage,
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
      if (type === "group") {
        result = await sendProactiveGroupMessage(accessToken, body.to, body.content);
      } else {
        result = await sendProactiveC2CMessage(accessToken, body.to, body.content);
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
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
      if (type === "group") {
        result = await sendGroupImageMessage(accessToken, body.to, body.imageUrl, undefined, body.content);
      } else {
        result = await sendC2CImageMessage(accessToken, body.to, body.imageUrl, undefined, body.content);
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
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
      if (type === "group") {
        result = await sendGroupVoiceMessage(accessToken, body.to, body.voiceUrl);
      } else {
        result = await sendC2CVoiceMessage(accessToken, body.to, body.voiceUrl);
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
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
      if (type === "group") {
        result = await sendGroupFileMessage(accessToken, body.to, body.fileUrl, undefined, undefined, body.fileName);
      } else {
        result = await sendC2CFileMessage(accessToken, body.to, body.fileUrl, undefined, undefined, body.fileName);
      }

      return c.json<ApiResponse<SendResponse>>({
        success: true,
        data: { messageId: result.id, timestamp: result.timestamp },
      });
    } catch (err) {
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
