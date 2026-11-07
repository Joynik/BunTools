import path from "node:path";
import { BunConfiguration, type ConfigSource } from "../configuration/bunfig";
import { realpath } from "node:fs/promises";
import { Runner } from "../bun/runner";
import type { Runtime } from "../bun/discovery";

export interface Fix {
  range: [number, number];
  text: string;
}
export interface Message {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  fix?: Fix;
}
export interface LintFile {
  filePath: string;
  messages: Message[];
  output?: string;
}
export function lintFile(file: string): boolean {
  return /\.[cm]?[jt]sx?$/i.test(file);
}
export function parseReport(text: string): LintFile[] {
  const report: unknown = JSON.parse(text);
  if (!Array.isArray(report))
    throw new Error("Unknown Bun lint JSON response.");
  for (const file of report) {
    if (
      !file ||
      typeof file.filePath !== "string" ||
      !Array.isArray(file.messages) ||
      (file.output !== undefined && typeof file.output !== "string")
    )
      throw new Error("Invalid Bun lint file response.");
    for (const message of file.messages) {
      if (
        !message ||
        typeof message.message !== "string" ||
        ![1, 2].includes(message.severity) ||
        !Number.isInteger(message.line) ||
        message.line < 1 ||
        !Number.isInteger(message.column) ||
        message.column < 1 ||
        (message.ruleId !== null && typeof message.ruleId !== "string")
      )
        throw new Error("Invalid Bun lint diagnostic.");
      if (
        message.endLine !== undefined &&
        (!Number.isInteger(message.endLine) || message.endLine < message.line)
      )
        throw new Error("Invalid Bun lint end position.");
      if (
        message.endColumn !== undefined &&
        (!Number.isInteger(message.endColumn) || message.endColumn < 1)
      )
        throw new Error("Invalid Bun lint end column.");
      if (
        message.endColumn !== undefined &&
        (message.endLine ?? message.line) === message.line &&
        message.endColumn < message.column
      )
        throw new Error("Bun lint range ends before its start.");
      if (
        message.fix &&
        (!Array.isArray(message.fix.range) ||
          message.fix.range.length !== 2 ||
          !message.fix.range.every(Number.isInteger) ||
          message.fix.range[0] < 0 ||
          message.fix.range[1] < message.fix.range[0] ||
          typeof message.fix.text !== "string")
      )
        throw new Error("Invalid Bun lint fix.");
    }
  }
  return report;
}

export class Linter {
  constructor(
    private readonly runner: Runner,
    readonly configuration = new BunConfiguration(runner),
  ) {}
  async ensureNative(
    runtime: Runtime,
    cwd: string,
    files: string[],
    signal?: AbortSignal,
    selection?: ConfigSource,
  ) {
    const config =
      selection ??
      (await this.configuration.resolve(
        runtime,
        "lint",
        cwd,
        files.length === 1 && files[0] !== "." ? files[0] : undefined,
        signal,
      ));
    const result = await this.runner.run(
      runtime.path,
      [
        ...config.prefix,
        "lint",
        "--no-script",
        "--doctor",
        "--format=json",
        ...files,
      ],
      { cwd: config.cwd, signal },
    );
    if (result.code !== 0)
      throw new Error("Bun lint configuration inspection failed.");
    const report = JSON.parse(result.stdout);
    if (!report?.files?.by_eslint || !report.rules?.javascript)
      throw new Error("Unknown Bun lint doctor response.");
    if (
      Object.keys(report.files.by_eslint).length ||
      Object.keys(report.rules.javascript).length
    )
      throw new Error(
        "Bun reports external ESLint or JavaScript rule delegation. Bun Tools requires native rules.",
      );
  }
  async run(
    runtime: Runtime,
    cwd: string,
    files: string[],
    options: {
      input?: string;
      fix?: boolean;
      write?: boolean;
      typeAware?: boolean;
      signal?: AbortSignal;
      selection?: ConfigSource;
    } = {},
  ): Promise<LintFile[]> {
    if (!runtime.lint) throw new Error(runtime.lintReason);
    if (options.fix && !runtime.fixes)
      throw new Error("This Bun does not support verified dry-run fixes.");
    const config =
      options.selection ??
      (await this.configuration.resolve(
        runtime,
        "lint",
        cwd,
        files.length === 1 && files[0] !== "." ? files[0] : undefined,
        options.signal,
      ));
    if (options.input === undefined && !options.selection) {
      let paths = files;
      if (files.some((file) => file === ".")) {
        const list = await this.runner.run(
          runtime.path,
          [...config.prefix, "lint", "--no-script", "--list-files", ...files],
          { cwd: config.cwd, signal: options.signal, timeout: 120000 },
        );
        if (list.code !== 0)
          throw new Error("Bun could not enumerate lint files.");
        paths = list.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((file) => path.resolve(config.cwd, file));
      }
      const reports: LintFile[] = [];
      for (const group of await this.configuration.groups(
        runtime,
        "lint",
        cwd,
        paths,
        options.signal,
      )) {
        reports.push(
          ...(await this.run(runtime, cwd, group.files, {
            ...options,
            selection: group.config,
          })),
        );
      }
      return reports;
    }
    await this.ensureNative(runtime, cwd, files, options.signal, config);
    const args = [...config.prefix, "lint", "--no-script", "--format=json"];
    if (options.input !== undefined) {
      if (files.length !== 1)
        throw new Error("Stdin lint requires one source path.");
      args.push("--stdin", "--stdin-filename", files[0]);
    } else args.push(...files);
    if (options.write && options.input !== undefined)
      throw new Error("Disk fixes cannot use unsaved stdin.");
    if (options.fix) args.push(options.write ? "--fix" : "--fix-dry-run");
    if (options.typeAware) {
      if (!runtime.typeAware)
        throw new Error("This Bun does not support type-aware lint.");
      args.push("--type-aware");
    }
    const result = await this.runner.run(runtime.path, args, {
      cwd: config.cwd,
      input: options.input,
      signal: options.signal,
      timeout: options.input === undefined ? 120000 : 15000,
    });
    if (result.code !== 0 && result.code !== 1)
      throw new Error(
        `Bun lint failed (${result.code}). Check project configuration.`,
      );
    const reports = parseReport(result.stdout);
    const canonicalRoot = await realpath(cwd);
    // Bun canonicalizes /var to /private/var on macOS; VS Code keeps workspace spelling.
    for (const report of reports) {
      const relative = path.relative(
        canonicalRoot,
        path.resolve(cwd, report.filePath),
      );
      if (
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      )
        report.filePath = path.resolve(cwd, relative);
    }
    return reports;
  }
}
