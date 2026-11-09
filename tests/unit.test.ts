import { test, expect } from "bun:test";
import { candidates, Discovery } from "../src/bun/discovery";
import { Runner } from "../src/bun/runner";
import os from "node:os";
import path from "node:path";

test("explicit path is authoritative and relative to its workspace", () => {
  expect(
    candidates({
      folder: "/a project",
      explicit: "./tools/bun",
      platform: "linux",
    }),
  ).toEqual(["/a project/tools/bun"]);
});
test("macOS includes local, PATH, Homebrew, official installer and BUN_INSTALL in order", () => {
  const found = candidates({
    folder: "/project",
    home: "/Users/a",
    platform: "darwin",
    env: { PATH: "/tool/bin", BUN_INSTALL: "/custom" },
  });
  expect(found[0]).toBe("/project/node_modules/.bin/bun");
  expect(found.indexOf("/tool/bin/bun")).toBeLessThan(
    found.indexOf("/opt/homebrew/bin/bun"),
  );
  expect(found).toContain("/usr/local/bin/bun");
  expect(found).toContain("/Users/a/.bun/bin/bun");
  expect(found.at(-1)).toBe("/custom/bin/bun");
});
test("Linux and Windows executable paths", () => {
  expect(candidates({ platform: "linux", home: "/home/a", env: {} })).toEqual([
    "/home/a/.bun/bin/bun",
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ]);
  const win = candidates({
    platform: "win32",
    home: "C:\\Users\\A",
    folder: "C:\\My Project",
    env: { Path: "C:\\Program Files\\Bun;D:\\bin", BUN_INSTALL: "D:\\Bun" },
  });
  expect(win).toContain("C:\\Program Files\\Bun\\bun.exe");
  expect(win[0]).toBe("C:\\My Project\\node_modules\\.bin\\bun.exe");
  expect(win.at(-1)).toBe("D:\\Bun\\bin\\bun.exe");
});
test("missing executable produces actionable error and cached result", async () => {
  const runner = new Runner();
  const discovery = new Discovery(runner);
  const options = {
    explicit: path.join(os.tmpdir(), "bun-tools-does-not-exist"),
  };
  const first = discovery.get(options);
  expect(first).toBe(discovery.get(options));
  await expect(first).rejects.toThrow("bunTools.bunPath");
  await expect(first).rejects.toThrow("Bun Tools: Restart");
  discovery.clear();
  expect(discovery.get(options)).not.toBe(first);
  await expect(discovery.get(options)).rejects.toThrow();
  runner.dispose();
});
test("runner handles spaces, Unicode, stdin and startup failure", async () => {
  const runner = new Runner();
  const result = await runner.run(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)", "argument with spaces"],
    { cwd: os.tmpdir(), input: "Привіт 😀\r\n" },
  );
  expect(result.stdout).toBe("Привіт 😀\r\n");
  await expect(
    runner.run("/no/such/bun", [], { cwd: os.tmpdir() }),
  ).rejects.toThrow();
  runner.dispose();
});
test("runner cancels running and queued requests, enforces timeout, and recovers queue", async () => {
  const runner = new Runner(1);
  const first = new AbortController(),
    queued = new AbortController();
  const a = runner.run(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
    cwd: os.tmpdir(),
    signal: first.signal,
  });
  const b = runner.run(process.execPath, ["--version"], {
    cwd: os.tmpdir(),
    signal: queued.signal,
  });
  const checks = Promise.allSettled([a, b]);
  queued.abort();
  first.abort();
  const results = await checks;
  expect(results.map((item) => item.status)).toEqual(["rejected", "rejected"]);
  await expect(
    runner.run(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
      cwd: os.tmpdir(),
      timeout: 25,
    }),
  ).rejects.toThrow("timed out");
  expect(
    (await runner.run(process.execPath, ["--version"], { cwd: os.tmpdir() }))
      .code,
  ).toBe(0);
  runner.dispose();
  await expect(
    runner.run(process.execPath, [], { cwd: os.tmpdir() }),
  ).rejects.toThrow("disposed");
});

import {
  minimalEdit,
  languages,
  supportedFile,
  djangoHtml,
} from "../src/formatter/core";
test("minimal edit preserves Unicode and CRLF boundaries", () => {
  for (const [before, after] of [
    ["😀\r\nx", "😁\r\ny"],
    ["a\r\nb", "a\nb"],
    ["", "😀"],
    ["x😀z", "x😁z"],
  ]) {
    const edit = minimalEdit(before, after)!;
    expect(
      before.slice(0, edit.start) + edit.text + before.slice(edit.end),
    ).toBe(after);
    expect(
      edit.start === 0 ||
        !(
          before.charCodeAt(edit.start) >= 0xdc00 &&
          before.charCodeAt(edit.start) <= 0xdfff
        ),
    ).toBe(true);
  }
  expect(minimalEdit("same", "same")).toBeUndefined();
});
test("Markdown, TOML, Django HTML and arbitrary languages are excluded", () => {
  for (const language of [
    "markdown",
    "toml",
    "django-html",
    "jinja-html",
    "python",
  ])
    expect(languages[language]).toBeUndefined();
  expect(supportedFile("a.md")).toBe(false);
  expect(supportedFile("a.toml")).toBe(false);
  expect(djangoHtml("a.html", '{% extends "base.html" %}')).toBe(true);
  expect(djangoHtml("a.vue", "<p>{{ message }}</p>")).toBe(false);
});
test("manifest does not override default formatter or official Bun commands", async () => {
  const manifest = await Bun.file(
    new URL("../package.json", import.meta.url),
  ).json();
  expect(manifest.extensionDependencies).toBeUndefined();
  expect(manifest.contributes.configurationDefaults).toBeUndefined();
  expect(
    manifest.contributes.commands.every((item: { command: string }) =>
      item.command.startsWith("bunTools."),
    ),
  ).toBe(true);
  expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false);
});

test("cancellation kills an already running process and disposal cancels the queue", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const temp = await mkdtemp(path.join(os.tmpdir(), "bun-tools-cancel-"));
  const marker = path.join(temp, "started");
  const runner = new Runner(1);
  const controller = new AbortController();
  try {
    const running = runner.run(
      process.execPath,
      [
        "-e",
        'require("node:fs").writeFileSync(process.argv[1], "ready"); setTimeout(()=>{},10000)',
        marker,
      ],
      { cwd: temp, signal: controller.signal },
    );
    const observed = Promise.allSettled([running]);
    const deadline = Date.now() + 2000;
    while (!(await Bun.file(marker).exists()) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await Bun.file(marker).exists()).toBe(true);
    const queued = runner.run(process.execPath, ["--version"], { cwd: temp });
    const queueResult = Promise.allSettled([queued]);
    const started = Date.now();
    controller.abort();
    runner.dispose();
    expect((await observed)[0].status).toBe("rejected");
    expect((await queueResult)[0].status).toBe("rejected");
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    runner.dispose();
    await rm(temp, { recursive: true, force: true });
  }
});

test("quoted Windows PATH and delegated formatter reports are handled safely", async () => {
  expect(
    candidates({
      platform: "win32",
      home: "C:\\Users\\A",
      env: { Path: '"C:\\Program Files\\Bun"' },
    }),
  ).toContain("C:\\Program Files\\Bun\\bun.exe");
  const { Formatter } = await import("../src/formatter/core");
  const runner = new Runner();
  const formatter = new Formatter(runner);
  const runtime = {
    path: "/fake/bun",
  } as import("../src/bun/discovery").Runtime;
  try {
    for (const report of [
      null,
      {},
      { files: { by_prettier: {} }, plugins: {} },
      {
        files: { by_prettier: { astro: 1 }, left_for_plugins: 0 },
        plugins: { by_prettier: [] },
      },
      {
        files: { by_prettier: {}, left_for_plugins: 1 },
        plugins: { by_prettier: [] },
      },
    ]) {
      runner.run = async () => ({
        code: 0,
        stdout: JSON.stringify(report),
        stderr: "",
      });
      await expect(
        formatter.ensureNative(runtime, os.tmpdir(), []),
      ).rejects.toThrow();
    }
  } finally {
    runner.dispose();
  }
});

test("a formatter-only Bun never probes a missing lint command", async () => {
  const runner = new Runner();
  const argsSeen: string[][] = [];
  runner.run = async (_executable, args) => {
    argsSeen.push(args);
    if (args[0] === "--version")
      return { code: 0, stdout: "1.4.4\n", stderr: "" };
    if (args[0] === "--revision")
      return { code: 0, stdout: "1.4.4+old\n", stderr: "" };
    if (args[0] === "--help")
      return { code: 0, stdout: "\n  fmt    Format code\n", stderr: "" };
    if (args[0] === "fmt")
      return {
        code: 0,
        stdout: "--stdin-filepath --no-script --doctor --list-files",
        stderr: "",
      };
    throw new Error("Unexpected probe");
  };
  try {
    const runtime = await new Discovery(runner).get({
      explicit: process.execPath,
    });
    expect(runtime.format).toBe(true);
    expect(runtime.lint).toBe(false);
    expect(runtime.fixes).toBe(false);
    expect(argsSeen.some((args) => args[0] === "lint")).toBe(false);
  } finally {
    runner.dispose();
  }
});
