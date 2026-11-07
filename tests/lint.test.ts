import { beforeAll, afterAll, test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Runner } from "../src/bun/runner";
import { Discovery, type Runtime } from "../src/bun/discovery";
import { Linter, parseReport } from "../src/linter/core";
import { Scheduler } from "../src/linter/scheduler";
const runner = new Runner();
const linter = new Linter(runner);
let runtime: Runtime, cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "bun lint tests "));
  runtime = await new Discovery(runner).get({});
  expect(runtime.lint).toBe(true);
  expect(runtime.fixes).toBe(true);
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { lint: "echo SCRIPT_RAN > BAD" },
    }),
  );
  await writeFile(
    path.join(cwd, "bunfig.toml"),
    '[lint.rules]\n"prefer-const" = "warn"\n"import/no-unresolved" = "error"\n',
  );
});
afterAll(async () => {
  runner.dispose();
  await rm(cwd, { recursive: true, force: true });
});
test("native JSON stdin diagnostics, multiple messages and UTF-16 fix ranges", async () => {
  const file = path.join(cwd, "space name.ts");
  await writeFile(file, "export const saved = 1;");
  const input = 'const emoji="😀"; let value=1;\nconsole.log(value);';
  const [report] = await linter.run(runtime, cwd, [file], { input });
  expect(report.messages.length).toBeGreaterThan(1);
  const message = report.messages.find(
    (message) => message.ruleId === "prefer-const",
  )!;
  expect(message.severity).toBe(1);
  expect(message.column - 1).toBe(input.indexOf("value="));
  expect(input.slice(...message.fix!.range)).toBe("let value=1;");
  expect(await readFile(file, "utf8")).toBe("export const saved = 1;");
  expect(await Bun.file(path.join(cwd, "BAD")).exists()).toBe(false);
});
test("stdin resolves relative imports using original source path", async () => {
  await writeFile(path.join(cwd, "dependency.ts"), "export const value=1;");
  const file = path.join(cwd, "unsaved.ts");
  const valid = await linter.run(runtime, cwd, [file], {
    input: 'import {value} from "./dependency"; console.log(value);',
  });
  expect(
    valid[0].messages.some(
      (message) => message.ruleId === "import/no-unresolved",
    ),
  ).toBe(false);
  const invalid = await linter.run(runtime, cwd, [file], {
    input: 'import {value} from "./missing"; console.log(value);',
  });
  expect(
    invalid[0].messages.some(
      (message) => message.ruleId === "import/no-unresolved",
    ),
  ).toBe(true);
});
test("dry-run returns fixed Unicode code without changing disk", async () => {
  const file = path.join(cwd, "dry.ts");
  const input = 'const emoji="😀"; let value=1; console.log(emoji,value);';
  await writeFile(file, input);
  const [report] = await linter.run(runtime, cwd, [file], { input, fix: true });
  expect(report.output).toContain("const value=1");
  expect(await readFile(file, "utf8")).toBe(input);
});
test("workspace safe fix writes through Bun and keeps ignore rules", async () => {
  await writeFile(path.join(cwd, ".gitignore"), "ignored.ts\n");
  await writeFile(
    path.join(cwd, "ignored.ts"),
    "let ignored=1; console.log(ignored);",
  );
  const file = path.join(cwd, "fix.ts");
  await writeFile(file, "let value=1; console.log(value);");
  await linter.run(runtime, cwd, ["."], { fix: true, write: true });
  expect(await readFile(file, "utf8")).toStartWith("const value");
  expect(await readFile(path.join(cwd, "ignored.ts"), "utf8")).toStartWith(
    "let ignored",
  );
});
test("parse errors are structured diagnostics and type-aware rules work", async () => {
  const [broken] = await linter.run(
    runtime,
    cwd,
    [path.join(cwd, "broken.ts")],
    { input: "const = ;" },
  );
  expect(broken.messages[0].severity).toBe(2);
  expect(broken.messages[0].message).toContain("Parsing error");
  const [typed] = await linter.run(runtime, cwd, [path.join(cwd, "typed.ts")], {
    input: "async function f(){ return 1; } f();",
    typeAware: true,
  });
  expect(
    typed.messages.some(
      (message) => message.ruleId === "@typescript-eslint/no-floating-promises",
    ),
  ).toBe(true);
});
test("parser rejects malformed output and invalid coordinates or fixes", () => {
  for (const report of [
    {},
    [
      {
        filePath: "a",
        messages: [
          { severity: 2, line: 0, column: 1, message: "bad", ruleId: null },
        ],
      },
    ],
    [
      {
        filePath: "a",
        messages: [
          {
            severity: 1,
            line: 1,
            column: 1,
            message: "bad",
            ruleId: "rule",
            fix: { range: [5, 1], text: "" },
          },
        ],
      },
    ],
  ])
    expect(() => parseReport(JSON.stringify(report))).toThrow();
});
test("debounce coalesces requests and aborts obsolete in-flight work", async () => {
  const scheduler = new Scheduler();
  const calls: string[] = [];
  scheduler.schedule("a", 30, async () => {
    calls.push("old");
  });
  scheduler.schedule("a", 10, async () => {
    calls.push("new");
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toEqual(["new"]);
  let aborted = false;
  const started = new Promise<void>((resolve) =>
    scheduler.schedule("a", 0, async (signal) => {
      resolve();
      await new Promise<void>((done) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            done();
          },
          { once: true },
        ),
      );
    }),
  );
  await started;
  scheduler.cancel("a");
  expect(aborted).toBe(true);
  scheduler.dispose();
});
