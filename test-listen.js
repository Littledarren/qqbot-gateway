#!/usr/bin/env node
/**
 * 监听消息脚本 - 通过 WebSocket 接收消息并打印
 * 
 * 使用方法:
 *   node test-listen.js
 */

const HTTP_PORT = process.env.HTTP_PORT || 3001;
const WS_URL = `ws://localhost:${HTTP_PORT}/ws`;

async function main() {
  console.log(`连接到: ${WS_URL}`);
  console.log("等待消息中... (按 Ctrl+C 退出)");
  console.log("");

  const WebSocket = (await import("ws")).default;
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("✅ WebSocket 已连接");
    console.log("");
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log("=".repeat(50));
      console.log(`📥 收到消息 [${new Date().toLocaleTimeString()}]`);
      console.log(`  类型: ${msg.type}`);
      console.log(`  发送者 OpenID: ${msg.sender.openid}`);
      console.log(`  发送者昵称: ${msg.sender.nickname || "(未知)"}`);
      console.log(`  内容: ${msg.content}`);
      if (msg.groupOpenid) {
        console.log(`  群 OpenID: ${msg.groupOpenid}`);
      }
      console.log("=".repeat(50));
      console.log("");
    } catch (err) {
      console.log("原始消息:", data.toString());
    }
  });

  ws.on("error", (err) => {
    console.log("❌ WebSocket 错误:", err.message);
    console.log("");
    console.log("请确保服务已启动: npm start");
  });

  ws.on("close", () => {
    console.log("WebSocket 已断开");
  });
}

main();
