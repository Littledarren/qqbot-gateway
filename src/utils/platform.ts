/**
 * 平台适配工具
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * 获取 QQ Bot 数据目录
 */
export function getQQBotDataDir(subdir?: string): string {
  const baseDir = process.env.QQBOT_DATA_DIR || path.join(os.homedir(), ".qqbot-gateway");
  const dataDir = subdir ? path.join(baseDir, subdir) : baseDir;

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  return dataDir;
}

/**
 * 规范化路径
 */
export function normalizePath(p: string): string {
  return path.normalize(p);
}

/**
 * 清理文件名
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 200);
}
