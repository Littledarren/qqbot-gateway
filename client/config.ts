/**
 * 客户端配置
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const CONFIG_FILE = path.join(os.homedir(), ".qqbot-gateway", "client.json");

export interface ClientConfig {
  gatewayUrl: string;
  targetOpenid: string;
  downloadsDir: string;
  cmdTimeout: number;
  chunkSize: number;
  chunkDelay: number;
}

const DEFAULTS: ClientConfig = {
  gatewayUrl: "http://localhost:3001",
  targetOpenid: "",
  downloadsDir: path.join(os.homedir(), "Downloads"),
  cmdTimeout: 30_000,
  chunkSize: 1800,
  chunkDelay: 300,
};

export function loadConfig(): ClientConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      // fall through
    }
  }

  // 尝试从 gateway 配置中读取 targetOpenid
  const gwConfigFile = path.join(os.homedir(), ".qqbot-gateway", "config.json");
  if (fs.existsSync(gwConfigFile)) {
    try {
      const raw = fs.readFileSync(gwConfigFile, "utf-8");
      const gw = JSON.parse(raw);
      if (gw.targetOpenid) {
        return { ...DEFAULTS, targetOpenid: gw.targetOpenid };
      }
    } catch {
      // fall through
    }
  }

  return { ...DEFAULTS };
}

export function saveConfig(config: Partial<ClientConfig>): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...DEFAULTS, ...config }, null, 2), "utf-8");
}
