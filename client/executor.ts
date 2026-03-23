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

/** 后台任务记录 */
export interface BackgroundJob {
  id: number;
  command: string;
  startTime: number;
  proc: ReturnType<typeof import("node:child_process").execFile>;
  completed: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

const bgJobs = new Map<number, BackgroundJob>();
let nextJobId = 1;

/**
 * 执行命令（后台模式，立即返回 jobId）
 */
export function executeBackground(
  command: string,
  onComplete: (job: BackgroundJob) => void,
): number {
  const id = nextJobId++;
  const job: BackgroundJob = {
    id,
    command,
    startTime: Date.now(),
    proc: null as any,
    completed: false,
    stdout: "",
    stderr: "",
  };

  job.proc = execFile("bash", ["-c", command], { encoding: "utf-8" }, (error, stdout, stderr) => {
    job.completed = true;
    job.exitCode = typeof error?.code === "number" ? error.code : 0;
    job.stdout = stdout || "";
    job.stderr = stderr || "";
    onComplete(job);
  });

  bgJobs.set(id, job);
  return id;
}

/**
 * 获取后台任务状态
 */
export function getBackgroundJob(id: number): BackgroundJob | undefined {
  return bgJobs.get(id);
}

/**
 * 列出所有后台任务
 */
export function listBackgroundJobs(): BackgroundJob[] {
  return Array.from(bgJobs.values());
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
