/**
 * QQ Bot Gateway - 独立服务入口
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { QQBotGateway } from "./gateway.js";
import { createHttpServer } from "./http-server.js";
import type { QQBotConfig, PushedMessage } from "./types.js";

// 配置文件路径
const CONFIG_FILE = path.join(os.homedir(), ".qqbot-gateway", "config.json");

// 默认配置
const DEFAULT_CONFIG = {
  appId: "",
  clientSecret: "",
  httpPort: 3001,
};

/**
 * 加载配置文件
 */
function loadConfig(): QQBotConfig & { httpPort: number } {
  // 尝试读取配置文件
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, "utf-8");
      const config = JSON.parse(content);
      return { ...DEFAULT_CONFIG, ...config };
    } catch (err) {
      console.error(`Failed to load config file: ${CONFIG_FILE}`);
      console.error(err);
    }
  }

  // 回退到环境变量
  return {
    appId: process.env.QQBOT_APP_ID || DEFAULT_CONFIG.appId,
    clientSecret: process.env.QQBOT_CLIENT_SECRET || DEFAULT_CONFIG.clientSecret,
    httpPort: parseInt(process.env.HTTP_PORT || String(DEFAULT_CONFIG.httpPort), 10),
  };
}

// 加载配置
const config = loadConfig();

// 验证配置
if (!config.appId || !config.clientSecret) {
  console.error("Error: Missing AppID or ClientSecret");
  console.error("");
  console.error("Please create a config file at:");
  console.error(`  ${CONFIG_FILE}`);
  console.error("");
  console.error("With the following content:");
  console.error(JSON.stringify(DEFAULT_CONFIG, null, 2));
  console.error("");
  console.error("Or set environment variables:");
  console.error("  QQBOT_APP_ID=xxx");
  console.error("  QQBOT_CLIENT_SECRET=xxx");
  process.exit(1);
}

// 日志工具
const log = {
  info: (msg: string) => console.log(`[qqbot] ${msg}`),
  error: (msg: string) => console.error(`[qqbot] ${msg}`),
  debug: process.env.DEBUG ? (msg: string) => console.log(`[qqbot:debug] ${msg}`) : undefined,
};

// 创建 Gateway
const gateway = new QQBotGateway({
  appId: config.appId,
  clientSecret: config.clientSecret,
  log,
  onReady: () => log.info("Gateway is ready!"),
  onError: (err) => log.error(`Gateway error: ${err.message}`),
});

// 创建 HTTP 服务
const httpServer = createHttpServer({
  port: config.httpPort,
  gateway,
  appId: config.appId,
  clientSecret: config.clientSecret,
});

// 消息回调 - 打印收到的消息（用于获取 openid）
gateway.onMessage((message: PushedMessage) => {
  log.info(`========== 收到消息 ==========`);
  log.info(`类型: ${message.type}`);
  log.info(`发送者 OpenID: ${message.sender.openid}`);
  log.info(`发送者昵称: ${message.sender.nickname || "(未知)"}`);
  log.info(`内容: ${message.content}`);
  if (message.groupOpenid) {
    log.info(`群 OpenID: ${message.groupOpenid}`);
  }
  log.info(`消息 ID: ${message.messageId}`);
  log.info(`==============================`);
});

// 启动
log.info(`Starting QQ Bot Gateway...`);
log.info(`AppID: ${config.appId.slice(0, 8)}...`);
log.info(`HTTP Port: ${config.httpPort}`);
log.info(`Config file: ${CONFIG_FILE}`);

// 启动 HTTP 服务
httpServer.start();

// 启动 Gateway
gateway.start();

// 优雅关闭
const shutdown = async () => {
  log.info("Shutting down...");
  gateway.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
