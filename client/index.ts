/**
 * QQ Bot 客户端 - 主入口
 *
 * 功能：
 *   - 非文字消息 → 下载到 ~/Downloads/
 *   - /bash <cmd> → 执行命令，返回结果
 *   - /get <path> → 发送文件给用户
 *   - /help → 显示帮助
 */
import WebSocket from "ws";
import { loadConfig, saveConfig, type ClientConfig } from "./config.js";
import { downloadAllAttachments, type AttachmentInfo } from "./downloader.js";
import { executeCommand, formatResult } from "./executor.js";
import { sendLongText, sendFile, sendText } from "./sender.js";

interface PushedMessage {
  type: string;
  sender: { id: string; openid: string; nickname?: string };
  content: string;
  messageId: string;
  timestamp: number;
  attachments?: AttachmentInfo[];
}

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

function getWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws") + "/ws";
}

async function handleMessage(msg: PushedMessage, config: ClientConfig): Promise<void> {
  const content = msg.content.trim();
  const openid = msg.sender.openid;
  const gatewayUrl = config.gatewayUrl;

  console.log(`[client] 收到消息: [${msg.type}] ${content?.slice(0, 80) || "(非文字)"}`);

  // 1. 附件处理
  if (msg.attachments && msg.attachments.length > 0) {
    console.log(`[client] 附件数: ${msg.attachments.length}`);
    const result = await downloadAllAttachments(msg.attachments, config);
    await sendText(gatewayUrl, openid, result);
    return;
  }

  if (!content) return;

  // 2. /help
  if (content === "/help") {
    await sendText(gatewayUrl, openid,
      "可用命令:\n" +
      "  /bash <命令>  - 执行 shell 命令\n" +
      "  /get <路径>    - 获取文件\n" +
      "  /help         - 显示帮助\n" +
      "\n发送非文字消息会自动保存到 ~/Downloads/"
    );
    return;
  }

  // 3. /bash <cmd>
  if (content.startsWith("/bash ")) {
    const cmd = content.slice(6).trim();
    if (!cmd) {
      await sendText(gatewayUrl, openid, "用法: /bash <命令>");
      return;
    }

    console.log(`[client] 执行命令: ${cmd}`);
    await sendText(gatewayUrl, openid, "执行中...");

    const result = executeCommand(cmd, config.cmdTimeout);
    const output = formatResult(await result);

    console.log(`[client] 命令结果 (${output.length} 字符):`);
    await sendLongText(gatewayUrl, openid, output, config.chunkSize, config.chunkDelay);
    return;
  }

  // 4. /get <path>
  if (content.startsWith("/get ")) {
    const filePath = content.slice(5).trim();
    if (!filePath) {
      await sendText(gatewayUrl, openid, "用法: /get <文件路径>");
      return;
    }

    // 支持 ~ 家目录
    const expanded = filePath.replace(/^~/, process.env.HOME || "/root");
    console.log(`[client] 发送文件: ${expanded}`);

    const success = await sendFile(gatewayUrl, openid, expanded);
    if (success) {
      console.log(`[client] 文件发送成功: ${expanded}`);
    }
    return;
  }

  // 5. 其他文字消息 — 忽略
}

async function startClient(): Promise<void> {
  const config = loadConfig();

  if (!config.targetOpenid) {
    console.error("Error: 未配置 targetOpenid");
    console.error("");
    console.error("请创建 ~/.qqbot-gateway/client.json:");
    console.error(JSON.stringify({ gatewayUrl: config.gatewayUrl, targetOpenid: "你的OpenID" }, null, 2));
    process.exit(1);
  }

  console.log(`[client] Gateway: ${config.gatewayUrl}`);
  console.log(`[client] Target: ${config.targetOpenid}`);
  console.log(`[client] Downloads: ${config.downloadsDir}`);

  const wsUrl = getWsUrl(config.gatewayUrl);
  let reconnectAttempts = 0;

  const connect = (): void => {
    console.log(`[client] 连接到 ${wsUrl}...`);
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      reconnectAttempts = 0;
      console.log("[client] 已连接");
    });

    ws.on("message", async (data: WebSocket.RawData) => {
      try {
        const msg: PushedMessage = JSON.parse(data.toString());
        // 只处理目标用户的消息
        if (msg.sender.openid !== config.targetOpenid) {
          console.log(`[client] 忽略来自 ${msg.sender.openid} 的消息`);
          return;
        }
        await handleMessage(msg, config);
      } catch (err) {
        console.error(`[client] 消息处理错误: ${err}`);
      }
    });

    ws.on("close", () => {
      console.log("[client] 连接断开");
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error(`[client] WebSocket 错误: ${err.message}`);
    });
  };

  const scheduleReconnect = (): void => {
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    reconnectAttempts++;
    console.log(`[client] ${delay}ms 后重连 (${reconnectAttempts})`);
    setTimeout(connect, delay);
  };

  connect();

  // 优雅关闭
  process.on("SIGINT", () => {
    console.log("\n[client] 退出");
    process.exit(0);
  });
}

startClient().catch((err) => {
  console.error("[client] 启动失败:", err);
  process.exit(1);
});
