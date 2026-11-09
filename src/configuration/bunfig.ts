import path from "node:path";
import os from "node:os";
import { stat, readFile, mkdtemp, rm } from "node:fs/promises";
import type { Runtime } from "../bun/discovery";
import { Runner } from "../bun/runner";

export type Tool = "fmt" | "lint";
export interface ConfigSource {
  source: "local" | "global" | "default";
  path?: string;
  cwd: string;
  prefix: string[];
}
export class BunConfiguration {
  private parsed = new Map<
    string,
    { stamp: string; value: Promise<string[]> }
  >();
  constructor(
    private runner: Runner,
    private globalPath: (file: string) => string = () =>
      "~/.config/bun/bunfig.toml",
  ) {}

  async sections(
    runtime: Runtime,
    file: string,
  ): Promise<string[] | undefined> {
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    const key = `${runtime.path}:${file}`;
    let cached = this.parsed.get(key);
    if (!cached || cached.stamp !== stamp) {
      const input = await readFile(file, "utf8");
      const result = (async () => {
        // An ambient bunfig.toml can execute preload code even for --eval.
        const cwd = await mkdtemp(path.join(os.tmpdir(), "bun-tools-toml-"));
        try {
          return await this.runner.run(
            runtime.path,
            [
              "--no-install",
              "--no-env-file",
              "-e",
              "const text = await new Response(Bun.stdin.stream()).text(); console.log(JSON.stringify(Object.keys(Bun.TOML.parse(text))));",
            ],
            { cwd, input, timeout: 5000 },
          );
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      })();
      const value = result.then((result) => {
        if (result.code !== 0)
          throw new Error(`Cannot parse Bun configuration: ${file}`);
        const keys: unknown = JSON.parse(result.stdout);
        if (
          !Array.isArray(keys) ||
          !keys.every((key) => typeof key === "string")
        )
          throw new Error(`Invalid Bun TOML response: ${file}`);
        return keys as string[];
      });
      if (this.parsed.size >= 64) this.parsed.clear();
      cached = { stamp, value };
      this.parsed.set(key, cached);
      value.catch(() => {
        if (this.parsed.get(key) === cached) this.parsed.delete(key);
      });
    }
    return cached.value;
  }
  async groups(
    runtime: Runtime,
    tool: Tool,
    cwd: string,
    files: string[],
    signal?: AbortSignal,
  ) {
    const groups = new Map<string, { config: ConfigSource; files: string[] }>();
    for (const file of files) {
      signal?.throwIfAborted();
      const config = await this.resolve(runtime, tool, cwd, file, signal);
      const key = JSON.stringify([config.cwd, config.prefix]);
      let group = groups.get(key);
      if (!group) {
        group = { config, files: [] };
        groups.set(key, group);
      }
      group.files.push(file);
    }
    return [...groups.values()].flatMap((group) => {
      const batches: { config: ConfigSource; files: string[] }[] = [];
      for (let index = 0; index < group.files.length; index += 30)
        batches.push({
          config: group.config,
          files: group.files.slice(index, index + 30),
        });
      return batches;
    });
  }
  globalFile(cwd: string, file?: string): string {
    let global = this.globalPath(file ?? path.join(cwd, "bunfig.toml")).trim();
    if (global === "~") global = os.homedir();
    else if (/^~[/\\]/.test(global))
      global = path.join(os.homedir(), global.slice(2));
    return global ? path.resolve(cwd, global) : "";
  }
  async resolve(
    runtime: Runtime,
    tool: Tool,
    cwd: string,
    file?: string,
    signal?: AbortSignal,
  ): Promise<ConfigSource> {
    signal?.throwIfAborted();
    let directory = file ? path.dirname(file) : cwd;
    // Respect the workspace boundary for documents within that workspace.
    const relative = path.relative(cwd, directory);
    const boundary =
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
        ? path.resolve(cwd)
        : path.parse(directory).root;
    while (true) {
      const local = path.join(directory, "bunfig.toml");
      if ((await this.sections(runtime, local))?.includes(tool))
        return { source: "local", path: local, cwd: directory, prefix: [] };
      if (directory === boundary || path.dirname(directory) === directory)
        break;
      directory = path.dirname(directory);
    }
    const global = this.globalFile(cwd, file);
    if (global) {
      if ((await this.sections(runtime, global))?.includes(tool))
        return {
          source: "global",
          path: global,
          cwd,
          prefix: [`--config=${global}`],
        };
    }
    return { source: "default", cwd, prefix: [] };
  }
}
