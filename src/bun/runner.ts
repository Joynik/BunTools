import { spawn } from "node:child_process";

export interface RunOptions {
  cwd: string;
  input?: string;
  signal?: AbortSignal;
  timeout?: number;
}
export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** A bounded queue shared by discovery and formatting. No shell or persistent daemon. */
export class Runner {
  private active = 0;
  private waiting: (() => void)[] = [];
  private controllers = new Set<AbortController>();
  private disposed = false;
  constructor(private readonly limit = 2) {}

  async run(
    executable: string,
    args: string[],
    options: RunOptions,
  ): Promise<Result> {
    if (this.disposed) throw new Error("Bun runner is disposed.");
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let acquired = false;
    try {
      await this.acquire(controller.signal);
      acquired = true;
      controller.signal.throwIfAborted();
      return await this.execute(executable, args, options, controller.signal);
    } finally {
      if (acquired) {
        this.active--;
        this.waiting.shift()?.();
      }
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }

  private async acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", aborted);
        this.active++;
        resolve();
      };
      const aborted = () => {
        this.waiting = this.waiting.filter((item) => item !== ready);
        reject(new Error("Bun operation cancelled."));
      };
      this.waiting.push(ready);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }

  private execute(
    executable: string,
    args: string[],
    options: RunOptions,
    signal: AbortSignal,
  ): Promise<Result> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        NO_COLOR: "1",
        BUN_CONFIG_NO_CLEAR_TERMINAL: "1",
      };
      // Runtime injection is unrelated to formatting and can execute arbitrary preload code.
      delete (env as NodeJS.ProcessEnv).BUN_OPTIONS;
      delete (env as NodeJS.ProcessEnv).NODE_OPTIONS;
      const child = spawn(executable, args, {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: "pipe",
      });
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let bytes = 0;
      let failure: Error | undefined;
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      const stop = (error: Error) => {
        if (failure) return;
        failure = error;
        child.kill();
        hardKill = setTimeout(() => child.kill("SIGKILL"), 500);
      };
      const abort = () => stop(new Error("Bun operation cancelled."));
      const timer = setTimeout(
        () => stop(new Error("Bun operation timed out.")),
        options.timeout ?? 15000,
      );
      signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(hardKill);
        signal.removeEventListener("abort", abort);
      };
      const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024)
          stop(new Error("Bun output exceeds 32 MiB."));
        else chunks.push(chunk);
      };
      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));
      child.on("error", (error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (code, killed) => {
        cleanup();
        if (failure) reject(failure);
        else if (killed) reject(new Error(`Bun terminated with ${killed}.`));
        else
          resolve({
            code: code ?? -1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
      });
      child.stdin.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error);
      });
      if (signal.aborted) abort();
      child.stdin.end(options.input ?? "");
    });
  }

  cancelAll(): void {
    for (const controller of this.controllers) controller.abort();
  }
  dispose(): void {
    this.disposed = true;
    this.cancelAll();
  }
}
