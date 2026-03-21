/**
 * 命令执行器
 * 执行 /bash 命令并返回结果
 */
import { execFile } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT = 30_000; // 30s

/**
 * 执行 bash 命令
 */
export function executeCommand(
  command: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "bash",
      ["-c", command],
      { timeout, maxBuffer: 10 * 1024 * 1024, encoding: "utf-8" },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve({ exitCode: -1, stdout, stderr, timedOut: true });
        } else {
          resolve({
            exitCode: typeof error?.code === "number" ? error.code : 0,
            stdout: stdout || "",
            stderr: stderr || "",
            timedOut: false,
          });
        }
      },
    );
  });
}

/**
 * 格式化执行结果
 */
export function formatResult(result: ExecResult): string {
  const lines: string[] = [];

  if (result.timedOut) {
    lines.push("执行超时 (30s)，已强制终止。");
  }

  if (result.stdout) {
    lines.push(result.stdout.trimEnd());
  }

  if (result.stderr) {
    lines.push(`[stderr] ${result.stderr.trimEnd()}`);
  }

  if (result.exitCode !== 0 && !result.timedOut) {
    lines.push(`[exit code: ${result.exitCode}]`);
  }

  if (lines.length === 0) {
    lines.push("(无输出)");
  }

  return lines.join("\n");
}
