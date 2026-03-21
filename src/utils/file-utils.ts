/**
 * 文件工具函数
 */
import fs from "node:fs";
import crypto from "node:crypto";

/**
 * 检查文件是否存在
 */
export async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 异步读取文件
 */
export async function readFileAsync(filePath: string): Promise<Buffer> {
  return fs.promises.readFile(filePath);
}

/**
 * 检查文件大小
 */
export function checkFileSize(filePath: string): number {
  const stats = fs.statSync(filePath);
  return stats.size;
}

/**
 * 判断是否为大文件（超过指定大小）
 */
export function isLargeFile(filePath: string, maxSizeMB = 10): boolean {
  const size = checkFileSize(filePath);
  return size > maxSizeMB * 1024 * 1024;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 计算文件哈希（用于缓存）
 */
export function computeFileHash(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
