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
  /** 命令别名映射 */
  aliases: Record<string, string>;
}

const DEFAULTS: ClientConfig = {
  gatewayUrl: "http://localhost:3001",
  targetOpenid: "",
  downloadsDir: path.join(os.homedir(), "Downloads"),
  cmdTimeout: 30_000,
  chunkSize: 1800,
  chunkDelay: 300,
  aliases: {},
};

export function loadConfig(): ClientConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed, aliases: { ...DEFAULTS.aliases, ...(parsed.aliases || {}) } };
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

export function saveAliases(aliases: Record<string, string>): void {
  const cfg = loadConfig();
  saveConfig({ ...cfg, aliases });
}

export function saveConfig(config: Partial<ClientConfig>): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...DEFAULTS, ...config }, null, 2), "utf-8");
}
