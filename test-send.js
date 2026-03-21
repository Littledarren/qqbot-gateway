#!/usr/bin/env node
/**
 * 测试脚本 - 发送消息给指定用户
 * 
 * 使用方法:
 *   node test-send.js <openid> <message>
 *   node test-send.js <openid> <message> <type>
 * 
 * 示例:
 *   node test-send.js E7A8F3B2C1D4E5F6A7B8C9D0E1F2A3B4 "Hello World"
 *   node test-send.js E7A8F3B2C1D4E5F6A7B8C9D0E1F2A3B4 "Hello Group" group
 */

const HTTP_PORT = process.env.HTTP_PORT || 3001;
const BASE_URL = `http://localhost:${HTTP_PORT}`;

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log("使用方法: node test-send.js <openid> <message> [type]");
    console.log("");
    console.log("参数:");
    console.log("  openid   - 目标用户的 OpenID");
    console.log("  message  - 要发送的消息内容");
    console.log("  type     - 消息类型: c2c (默认) 或 group");
    console.log("");
    console.log("示例:");
    console.log("  node test-send.js E7A8F3B2C1D4E5F6A7B8C9D0E1F2A3B4 'Hello World'");
    console.log("  node test-send.js A1B2C3D4E5F6A7B8 '群消息测试' group");
    process.exit(1);
  }

  const openid = args[0];
  const content = args[1];
  const type = args[2] || "c2c";

  console.log(`发送消息到: ${openid}`);
  console.log(`消息类型: ${type}`);
  console.log(`消息内容: ${content}`);
  console.log("");

  try {
    const response = await fetch(`${BASE_URL}/api/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: openid,
        type: type,
        content: content,
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log("✅ 消息发送成功!");
      console.log(`消息 ID: ${result.data.messageId}`);
      console.log(`时间戳: ${result.data.timestamp}`);
    } else {
      console.log("❌ 消息发送失败!");
      console.log(`错误: ${result.error}`);
    }
  } catch (err) {
    console.log("❌ 请求失败!");
    console.log(`错误: ${err.message}`);
    console.log("");
    console.log("请确保服务已启动: npm start");
  }
}

main();
