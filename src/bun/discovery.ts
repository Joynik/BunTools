import path from "node:path";
import os from "node:os";
import { access, realpath, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { Runner } from "./runner";

export interface Runtime {
  path: string;
  version: string;
  format: boolean;
  range: boolean;
  nativeLintAdvertised: boolean;
  lint: boolean;
  fixes: boolean;
  typeAware: boolean;
  revision: string;
  lintReason: string;
  help: string;
}
export interface DiscoveryOptions {
  folder?: string;
  explicit?: string;
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}
export function candidates(options: DiscoveryOptions): string[] {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const p = platform === "win32" ? path.win32 : path.posix;
  const exe = platform === "win32" ? "bun.exe" : "bun";
  if (options.explicit?.trim()) {
    let explicit = options.explicit.trim();
    if (explicit.startsWith("~/") || explicit.startsWith("~\\"))
      explicit = p.join(home, explicit.slice(2));
    return [
      p.isAbsolute(explicit)
        ? explicit
        : p.resolve(options.folder ?? home, explicit),
    ];
  }
  const paths: string[] = [];
  if (options.folder) {
    paths.push(p.join(options.folder, "node_modules", ".bin", exe));
    paths.push(p.join(options.folder, "node_modules", "bun", "bin", exe));
    paths.push(p.join(options.folder, ".bun", "bin", exe));
  }
  const searchPath = env.PATH ?? env.Path ?? "";
  for (const entry of searchPath.split(platform === "win32" ? ";" : ":")) {
    const directory = entry.replace(/^"|"$/g, "");
    if (directory && p.isAbsolute(directory))
      paths.push(p.join(directory, exe));
  }
  paths.push(p.join(home, ".bun", "bin", exe));
  if (platform === "darwin")
    paths.push("/opt/homebrew/bin/bun", "/usr/local/bin/bun");
  else if (platform === "win32") {
    if (env.LOCALAPPDATA)
      paths.push(p.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", exe));
    paths.push(p.join(home, "scoop", "shims", exe));
  } else paths.push("/usr/local/bin/bun", "/usr/bin/bun");
  if (env.BUN_INSTALL) paths.push(p.join(env.BUN_INSTALL, "bin", exe));
  return [...new Set(paths)];
}

export class Discovery {
  private cache = new Map<string, Promise<Runtime>>();
  constructor(private readonly runner: Runner) {}
  clear(): void {
    this.cache.clear();
  }
  get(options: DiscoveryOptions): Promise<Runtime> {
    const key = JSON.stringify([options.folder, options.explicit]);
    let result = this.cache.get(key);
    if (!result) {
      result = this.find(options);
      this.cache.set(key, result);
    }
    return result;
  }
  private async find(options: DiscoveryOptions): Promise<Runtime> {
    // Probe outside the project: an unknown Bun command can otherwise run a package script.
    const probe = await mkdtemp(path.join(os.tmpdir(), "bun-tools-probe-"));
    const errors: string[] = [];
    try {
      for (const candidate of candidates(options)) {
        try {
          await access(
            candidate,
            process.platform === "win32" ? constants.F_OK : constants.X_OK,
          );
          const executable = await realpath(candidate);
          const version = await this.runner.run(executable, ["--version"], {
            cwd: probe,
            timeout: 5000,
          });
          if (
            version.code !== 0 ||
            !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version.stdout.trim())
          )
            throw new Error("Invalid bun --version result.");
          const top = await this.runner.run(executable, ["--help"], {
            cwd: probe,
            timeout: 5000,
          });
          const nativeFormat = /^\s+fmt\s/m.test(top.stdout);
          let help = "";
          if (nativeFormat) {
            const result = await this.runner.run(
              executable,
              ["fmt", "--no-script", "--help", "--all"],
              { cwd: probe, timeout: 5000 },
            );
            if (result.code === 0) help = result.stdout;
          }
          const advertised = /^\s+lint\s/m.test(top.stdout);
          let lintHelp = "";
          let lint = false,
            fixes = false;
          if (advertised) {
            const usage = await this.runner.run(
              executable,
              ["lint", "--no-script", "--help", "--all"],
              { cwd: probe, timeout: 5000 },
            );
            if (usage.code === 0) lintHelp = usage.stdout;
            if (
              [
                "--no-script",
                "--stdin",
                "--stdin-filename",
                "--doctor",
                "json",
              ].every((flag) => lintHelp.includes(flag))
            ) {
              const args = [
                "lint",
                "--no-script",
                "--format=json",
                "--stdin",
                "--stdin-filename",
                path.join(probe, "probe.ts"),
              ];
              const input = "let value=1; console.log(value);";
              const result = await this.runner.run(executable, args, {
                cwd: probe,
                input,
                timeout: 5000,
              });
              try {
                const report = JSON.parse(result.stdout);
                lint =
                  result.code <= 1 &&
                  Array.isArray(report) &&
                  report.length === 1 &&
                  Array.isArray(report[0].messages);
                if (lint && lintHelp.includes("--fix-dry-run")) {
                  const fixed = await this.runner.run(
                    executable,
                    [...args, "--fix-dry-run"],
                    { cwd: probe, input, timeout: 5000 },
                  );
                  fixes =
                    fixed.code <= 1 &&
                    typeof JSON.parse(fixed.stdout)[0]?.output === "string";
                }
              } catch {
                /* Unknown JSON contracts remain disabled. */
              }
            }
          }
          const revision = await this.runner.run(executable, ["--revision"], {
            cwd: probe,
            timeout: 5000,
          });
          return {
            path: executable,
            version: version.stdout.trim(),
            format:
              help.includes("--stdin-filepath") &&
              help.includes("--no-script") &&
              help.includes("--doctor") &&
              help.includes("--list-files"),
            range:
              help.includes("--range-start") && help.includes("--range-end"),
            nativeLintAdvertised: advertised,
            lint,
            fixes,
            typeAware: lint && lintHelp.includes("--type-aware"),
            revision:
              revision.code === 0
                ? revision.stdout.trim()
                : version.stdout.trim(),
            lintReason: lint
              ? "Native JSON diagnostics and stdin are verified."
              : `Bun ${version.stdout.trim()} lacks the verified native lint JSON/stdin contract. Project lint scripts are never executed.`,
            help,
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            errors.push(`${candidate}: ${String(error)}`);
        }
      }
      throw new Error(
        `Bun was not found or could not run. Install Bun manually or set bunTools.bunPath.${errors.length ? `\n${errors.join("\n")}` : ""}`,
      );
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
  }
}
