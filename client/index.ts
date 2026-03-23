/**
 * QQ Bot 客户端 - 主入口
 *
 * 功能：
 *   - 非文字消息 → 下载到 ~/Downloads/
 *   - /bash <cmd> → 执行命令，返回 markdown 代码块结果
 *   - /get <path> → 发送文件给用户
 *   - /help → 显示帮助
 *   - /alias add <name>=<cmd> → 添加命令别名
 *   - /alias del <name> → 删除别名
 *   - /jobs → 查看后台任务
 *   - 危险命令（rm -rf 等）执行前需确认
 */
import WebSocket from "ws";
import { loadConfig, saveAliases, type ClientConfig } from "./config.js";
import { downloadAllAttachments, type AttachmentInfo } from "./downloader.js";
import { executeCommand, formatResult, executeBackground, getBackgroundJob, listBackgroundJobs } from "./executor.js";
import { sendLongText, sendFile, sendText, sendMarkdown, sendLongTextMarkdown, sendProactive } from "./sender.js";

interface PushedMessage {
  type: string;
  sender: { id: string; openid: string; nickname?: string };
  content: string;
  messageId: string;
  timestamp: number;
  attachments?: AttachmentInfo[];
  /** 引用消息内容 */
  quote?: { id: string; content?: string; senderName?: string };
  /** 引用消息的 refIdx */
  refMsgIdx?: string;
}

/** 等待确认的危险命令 */
interface PendingConfirmation {
  openid: string;
  command: string;
  timeout: NodeJS.Timeout;
}

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const CONFIRM_TIMEOUT_MS = 30_000;

function getWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws") + "/ws";
}

function getGatewayUrl(httpUrl: string): string {
  return httpUrl;
}

/** 危险命令关键词 */
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\brm\s+-r\s+\/\b/,
  /\bdd\s+if\b/,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+0\b/,
  /\binit\s+6\b/,
  /\b:(){ :|:& };:/, // fork bomb
];

function isDangerous(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(cmd));
}

/** 展开命令别名 */
function expandAlias(cmd: string, aliases: Record<string, string>): string {
  const trimmed = cmd.trim();
  // /alias add name=cmd 或 /alias add name = cmd
  if (trimmed.startsWith("/alias")) return cmd; // 别名定义不展开

  // 展开命令开头
  const parts = trimmed.split(/\s+/);
  const base = parts[0]!;
  if (aliases[base]) {
    return aliases[base] + " " + parts.slice(1).join(" ");
  }
  return cmd;
}

async function handleMessage(msg: PushedMessage, config: ClientConfig): Promise<void> {
  const content = msg.content.trim();
  const openid = msg.sender.openid;
  const gatewayUrl = getGatewayUrl(config.gatewayUrl);

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
      "  /bash <命令>    - 执行 shell 命令（结果用 markdown 返回）\n" +
      "  /bash-long <命令> - 后台执行，完成后通知\n" +
      "  /get <路径>      - 获取文件\n" +
      "  /alias add <name>=<cmd>  - 添加命令别名\n" +
      "  /alias del <name>        - 删除别名\n" +
      "  /alias list              - 查看所有别名\n" +
      "  /jobs                    - 查看后台任务\n" +
      "  /help                   - 显示帮助\n" +
      "\n发送非文字消息会自动保存到 ~/Downloads/\n" +
      "危险命令（rm -rf 等）需确认后执行"
    );
    return;
  }

  // 3. /alias 处理
  if (content.startsWith("/alias")) {
    const aliasParts = content.slice(6).trim();
    if (aliasParts.startsWith("add ")) {
      // /alias add name=cmd 或 /alias add name = cmd
      const m = aliasParts.slice(4).match(/^\s*(\S+?)\s*=\s*(.+)$/);
      if (!m) {
        await sendText(gatewayUrl, openid, "用法: /alias add <name>=<cmd>");
        return;
      }
      const [, name, cmd] = m;
      if (name === "add" || name === "del" || name === "list") {
        await sendText(gatewayUrl, openid, "别名不能是 add/del/list");
        return;
      }
      config.aliases[name!] = cmd!.trim();
      saveAliases(config.aliases);
      await sendText(gatewayUrl, openid, `已添加别名: /${name} → ${cmd}`);
    } else if (aliasParts.startsWith("del ")) {
      const name = aliasParts.slice(4).trim();
      if (config.aliases[name]) {
        delete config.aliases[name];
        saveAliases(config.aliases);
        await sendText(gatewayUrl, openid, `已删除别名: ${name}`);
      } else {
        await sendText(gatewayUrl, openid, `未找到别名: ${name}`);
      }
    } else if (aliasParts.trim() === "list" || aliasParts === "") {
      const entries = Object.entries(config.aliases);
      if (entries.length === 0) {
        await sendText(gatewayUrl, openid, "暂无别名");
      } else {
        const lines = entries.map(([k, v]) => `  /${k} → ${v}`);
        await sendText(gatewayUrl, openid, `别名列表:\n${lines.join("\n")}`);
      }
    } else {
      await sendText(gatewayUrl, openid, "用法:\n  /alias add <name>=<cmd>\n  /alias del <name>\n  /alias list");
    }
    return;
  }

  // 4. /jobs - 查看后台任务
  if (content === "/jobs") {
    const jobs = listBackgroundJobs();
    if (jobs.length === 0) {
      await sendText(gatewayUrl, openid, "暂无后台任务");
      return;
    }
    const lines = jobs.map((j) => {
      const status = j.completed ? `[完成]` : `[运行中]`;
      const duration = j.completed
        ? `${((Date.now() - j.startTime) / 1000).toFixed(1)}s`
        : `${((Date.now() - j.startTime) / 1000).toFixed(1)}s`;
      const cmdPreview = j.command.length > 50 ? j.command.slice(0, 50) + "..." : j.command;
      return `${status} [Job ${j.id}] ${cmdPreview} (${duration})`;
    });
    await sendText(gatewayUrl, openid, lines.join("\n"));
    return;
  }

  // 5. /bash-long <cmd> - 后台执行
  if (content.startsWith("/bash-long ")) {
    const rawCmd = content.slice(11).trim();
    const command = expandAlias(rawCmd, config.aliases);
    if (!command) {
      await sendText(gatewayUrl, openid, "用法: /bash-long <命令>");
      return;
    }

    const jobId = executeBackground(command, async (job) => {
      const duration = ((Date.now() - job.startTime) / 1000).toFixed(1);
      const result = formatResult({ ...job, timedOut: false } as any);
      const notification = `\`\`\`\n[Job ${job.id}] 完成 (${duration}s)\n${result}\n\`\`\``;
      await sendMarkdown(gatewayUrl, openid, notification);
    });

    await sendText(gatewayUrl, openid, `已在后台运行 [Job ${jobId}]: ${rawCmd}\n完成后将通知您`);
    return;
  }

  // 6. /bash <cmd>
  if (content.startsWith("/bash ")) {
    const rawCmd = content.slice(6).trim();
    const command = expandAlias(rawCmd, config.aliases);
    if (!command) {
      await sendText(gatewayUrl, openid, "用法: /bash <命令>");
      return;
    }

    // 危险命令需确认
    if (isDangerous(command)) {
      pendingConfirmations.set(openid, {
        openid,
        command,
        timeout: setTimeout(() => {
          pendingConfirmations.delete(openid);
          sendText(gatewayUrl, openid, "命令确认已超时");
        }, CONFIRM_TIMEOUT_MS),
      });
      await sendText(gatewayUrl, openid,
        `⚠️ 检测到危险命令: ${rawCmd}\n请在 30 秒内回复 "yes" 确认执行`
      );
      return;
    }

    console.log(`[client] 执行命令: ${command}`);
    await sendText(gatewayUrl, openid, "执行中...");

    const result = executeCommand(command, config.cmdTimeout);
    const output = formatResult(await result);

    // 长输出用 markdown 代码块，短输出用普通文本
    if (output.length > 500) {
      await sendLongTextMarkdown(gatewayUrl, openid, output);
    } else {
      const formatted = `\`\`\`bash\n${output}\n\`\`\``;
      await sendMarkdown(gatewayUrl, openid, formatted);
    }
    return;
  }

  // 7. 处理危险命令确认（用户回复 "yes"）
  const pending = pendingConfirmations.get(openid);
  if (pending && content.toLowerCase() === "yes") {
    clearTimeout(pending.timeout);
    pendingConfirmations.delete(openid);
    console.log(`[client] 确认执行危险命令: ${pending.command}`);
    await sendText(gatewayUrl, openid, "执行中...");

    const result = executeCommand(pending.command, config.cmdTimeout);
    const output = formatResult(await result);

    if (output.length > 500) {
      await sendLongTextMarkdown(gatewayUrl, openid, output);
    } else {
      const formatted = `\`\`\`bash\n${output}\n\`\`\``;
      await sendMarkdown(gatewayUrl, openid, formatted);
    }
    return;
  }

  // 8. /get <path>
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

  // 9. 其他文字消息 — 忽略（client 不处理对话）
}

/** 待确认的危险命令 */
const pendingConfirmations = new Map<string, PendingConfirmation>();

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
  console.log(`[client] Aliases: ${Object.keys(config.aliases).join(", ") || "(无)"}`);

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
