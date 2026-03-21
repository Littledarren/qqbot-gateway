/**
 * 消息发送器
 * 封装分段发送和文件发送
 */
import path from "node:path";
import fs from "node:fs";
import type { ClientConfig } from "./config.js";

const DEFAULT_CHUNK_SIZE = 1800;
const DEFAULT_CHUNK_DELAY = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 发送文本消息（单条）
 */
export async function sendText(gatewayUrl: string, openid: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(`${gatewayUrl}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: openid, type: "c2c", content }),
    });
    const data = await res.json() as { success: boolean; error?: string };
    if (!data.success) {
      console.error(`[sender] 发送失败: ${data.error}`);
    }
    return data.success;
  } catch (err) {
    console.error(`[sender] 请求失败: ${err}`);
    return false;
  }
}

/**
 * 将长文本分段发送
 */
export async function sendLongText(
  gatewayUrl: string,
  openid: string,
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkDelay = DEFAULT_CHUNK_DELAY,
): Promise<void> {
  if (text.length <= chunkSize) {
    await sendText(gatewayUrl, openid, text);
    return;
  }

  // 按行分割，尽量不在行中间断开
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > chunkSize && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) {
    chunks.push(current);
  }

  // 如果单行就超过 chunkSize，强制截断
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= chunkSize) {
      finalChunks.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += chunkSize) {
        finalChunks.push(chunk.slice(i, i + chunkSize));
      }
    }
  }

  const total = finalChunks.length;
  for (let i = 0; i < total; i++) {
    const prefix = total > 1 ? `[${i + 1}/${total}]\n` : "";
    const suffix = i === total - 1 ? "\n[完成]" : "...";
    const msg = prefix + finalChunks[i] + (total > 1 ? suffix : "");

    await sendText(gatewayUrl, openid, msg);

    if (i < total - 1) {
      await delay(chunkDelay);
    }
  }
}

/**
 * 判断文件类型并发送文件
 */
export async function sendFile(
  gatewayUrl: string,
  openid: string,
  filepath: string,
): Promise<boolean> {
  const resolved = path.resolve(filepath);

  if (!fs.existsSync(resolved)) {
    await sendText(gatewayUrl, openid, `文件不存在: ${filepath}`);
    return false;
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    await sendText(gatewayUrl, openid, `不是文件: ${filepath}`);
    return false;
  }

  const ext = path.extname(resolved).toLowerCase();
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext);

  // 先用 base64 读取文件内容
  const buffer = fs.readFileSync(resolved);
  const base64 = buffer.toString("base64");
  const dataUrl = `data:application/octet-stream;base64,${base64}`;
  const filename = path.basename(resolved);

  if (isImage) {
    // 图片：用 image 接口
    try {
      const res = await fetch(`${gatewayUrl}/api/send/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: openid,
          type: "c2c",
          imageUrl: dataUrl,
          content: filename,
        }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) {
        console.error(`[sender] 图片发送失败: ${data.error}`);
        await sendText(gatewayUrl, openid, `图片发送失败: ${data.error}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[sender] 图片发送请求失败: ${err}`);
      return false;
    }
  } else {
    // 其他文件：用 file 接口
    try {
      const res = await fetch(`${gatewayUrl}/api/send/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: openid,
          type: "c2c",
          fileUrl: dataUrl,
          fileName: filename,
        }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) {
        console.error(`[sender] 文件发送失败: ${data.error}`);
        await sendText(gatewayUrl, openid, `文件发送失败: ${data.error}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[sender] 文件发送请求失败: ${err}`);
      return false;
    }
  }
}
