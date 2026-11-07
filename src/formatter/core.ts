import path from "node:path";
import { BunConfiguration, type ConfigSource } from "../configuration/bunfig";
import { Runner } from "../bun/runner";
import type { Runtime } from "../bun/discovery";

export const languages: Record<string, string> = {
  javascript: ".js",
  javascriptreact: ".jsx",
  typescript: ".ts",
  typescriptreact: ".tsx",
  html: ".html",
  css: ".css",
  scss: ".scss",
  less: ".less",
  vue: ".vue",
  json: ".json",
  jsonc: ".jsonc",
  json5: ".json5",
  graphql: ".graphql",
  yaml: ".yaml",
};
const extensions = new Set([
  ...Object.values(languages),
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".yml",
  ".gql",
]);
export function supportedFile(file: string): boolean {
  return extensions.has(path.extname(file).toLowerCase());
}
export function djangoHtml(file: string, text: string): boolean {
  return /\.html?$/i.test(file) && /{%|{{/.test(text);
}

export interface OffsetEdit {
  start: number;
  end: number;
  text: string;
}
/** Trim identical context without splitting a UTF-16 surrogate pair or CRLF. */
export function minimalEdit(
  before: string,
  after: string,
): OffsetEdit | undefined {
  if (before === after) return;
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  const unsafe = (text: string, offset: number) =>
    offset > 0 &&
    offset < text.length &&
    ((text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff) ||
      (text[offset - 1] === "\r" && text[offset] === "\n"));
  if (unsafe(before, start) || unsafe(after, start)) start--;
  let end = before.length,
    afterEnd = after.length;
  while (
    end > start &&
    afterEnd > start &&
    before[end - 1] === after[afterEnd - 1]
  ) {
    end--;
    afterEnd--;
  }
  if (unsafe(before, end) || unsafe(after, afterEnd)) {
    end++;
    afterEnd++;
  }
  return { start, end, text: after.slice(start, afterEnd) };
}

export class Formatter {
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
  ): Promise<void> {
    const config =
      selection ??
      (await this.configuration.resolve(
        runtime,
        "fmt",
        cwd,
        files.length === 1 ? files[0] : undefined,
        signal,
      ));
    const result = await this.runner.run(
      runtime.path,
      [
        ...config.prefix,
        "fmt",
        "--no-script",
        "--doctor",
        "--format=json",
        ...files,
      ],
      { cwd: config.cwd, signal },
    );
    if (result.code !== 0)
      throw new Error(
        cliError(
          result.stderr,
          "Bun formatter configuration inspection failed.",
        ),
      );
    const report = JSON.parse(result.stdout);
    if (
      !report?.files ||
      !report.plugins ||
      !report.files.by_prettier ||
      typeof report.files.by_prettier !== "object" ||
      Array.isArray(report.files.by_prettier) ||
      !Array.isArray(report.plugins.by_prettier) ||
      typeof report.files.left_for_plugins !== "number"
    )
      throw new Error("Unknown Bun doctor response.");
    if (
      Object.keys(report.files.by_prettier).length ||
      report.plugins.by_prettier?.length ||
      report.files.left_for_plugins
    ) {
      throw new Error(
        "This configuration delegates formatting to external plugins. Bun Tools requires native Bun formatting.",
      );
    }
  }

  async format(
    runtime: Runtime,
    cwd: string,
    file: string,
    input: string,
    signal?: AbortSignal,
    range?: { start: number; end: number },
    parser?: "jsonc",
  ): Promise<string> {
    if (!runtime.format)
      throw new Error(
        `Bun ${runtime.version} does not provide the required native formatter flags. Install Bun 1.4.4 or newer.`,
      );
    const config = await this.configuration.resolve(
      runtime,
      "fmt",
      cwd,
      file,
      signal,
    );
    await this.ensureNative(runtime, cwd, [file], signal, config);
    const args = [
      ...config.prefix,
      "fmt",
      "--no-script",
      "--stdin-filepath",
      file,
    ];
    if (parser) args.push(`--parser=${parser}`);
    if (range) {
      if (!runtime.range)
        throw new Error("This Bun does not support selection formatting.");
      args.push(`--range-start=${range.start}`, `--range-end=${range.end}`);
    }
    const result = await this.runner.run(runtime.path, args, {
      cwd: config.cwd,
      input,
      signal,
    });
    if (result.code !== 0)
      throw new Error(
        cliError(result.stderr, `Bun formatting failed (${result.code}).`),
      );
    return result.stdout;
  }
}

function cliError(stderr: string, fallback: string): string {
  return (
    stderr
      .split(/\r?\n/)
      .find((line) => /^error:/i.test(line.trim()))
      ?.trim() ?? fallback
  );
}
