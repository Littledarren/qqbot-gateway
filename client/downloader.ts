/**
 * 附件下载器
 * 将收到的非文字消息（图片、语音、视频、文件）下载到本地
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ClientConfig } from "./config.js";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 根据 content_type 推断文件扩展名
 */
function getExtension(contentType: string, filename?: string): string {
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ext) return ext;
  }
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "audio/silk": ".silk",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/amr": ".amr",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return map[contentType.toLowerCase()] || ".bin";
}

export interface DownloadResult {
  success: boolean;
  filepath?: string;
  filename?: string;
  error?: string;
}

/**
 * 下载单个附件
 */
export async function downloadAttachment(
  url: string,
  contentType: string,
  filename?: string,
  config?: ClientConfig,
): Promise<DownloadResult> {
  const dir = config?.downloadsDir || path.join(process.env.HOME || "/tmp", "Downloads");
  ensureDir(dir);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const ext = getExtension(contentType, filename);
    const baseName = filename
      ? path.basename(filename, path.extname(filename))
      : new Date().toISOString().replace(/[:.]/g, "-");
    const finalName = `${baseName}${ext}`;
    const filepath = path.join(dir, finalName);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    return { success: true, filepath, filename: finalName };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface AttachmentInfo {
  content_type: string;
  url: string;
  filename?: string;
}

/**
 * 下载消息中的所有附件，返回结果摘要
 */
export async function downloadAllAttachments(
  attachments: AttachmentInfo[],
  config?: ClientConfig,
): Promise<string> {
  const results: string[] = [];

  for (const att of attachments) {
    const result = await downloadAttachment(att.url, att.content_type, att.filename, config);
    if (result.success) {
      results.push(`已保存: ${result.filename}`);
    } else {
      results.push(`下载失败: ${att.filename || att.content_type} - ${result.error}`);
    }
  }

  return results.join("\n");
}
