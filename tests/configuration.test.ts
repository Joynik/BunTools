import { beforeAll, afterAll, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Runner } from "../src/bun/runner";
import { Discovery, type Runtime } from "../src/bun/discovery";
import { BunConfiguration } from "../src/configuration/bunfig";
import { Formatter } from "../src/formatter/core";
import { Linter } from "../src/linter/core";
const runner = new Runner();
let runtime: Runtime, root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "bun global config "));
  runtime = await new Discovery(runner).get({});
});
afterAll(async () => {
  runner.dispose();
  await rm(root, { recursive: true, force: true });
});
async function project(name: string) {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  return directory;
}

test("global sections apply through native root --config to formatting and lint", async () => {
  const cwd = await project("global");
  const global = path.join(root, "global config.toml");
  await writeFile(
    global,
    '[fmt]\nsemi=false\nsingleQuote=true\n[lint.rules]\n"no-console"="error"\n',
  );
  const configuration = new BunConfiguration(runner, () => global);
  const file = path.join(cwd, "unsaved.ts");
  expect((await configuration.resolve(runtime, "fmt", cwd, file)).source).toBe(
    "global",
  );
  expect(
    await new Formatter(runner, configuration).format(
      runtime,
      cwd,
      file,
      'const value="hi";',
    ),
  ).toBe("const value = 'hi'\n");
  const [report] = await new Linter(runner, configuration).run(
    runtime,
    cwd,
    [file],
    { input: "console.log(1);" },
  );
  expect(
    report.messages.some(
      (message) => message.ruleId === "no-console" && message.severity === 2,
    ),
  ).toBe(true);
});
test("local fmt does not merge global fmt; missing local lint uses global lint", async () => {
  const cwd = await project("split-fmt");
  const global = path.join(cwd, "global.toml");
  await writeFile(
    global,
    '[fmt]\nsemi=false\nsingleQuote=true\n[lint.rules]\n"no-console"="error"\n',
  );
  await writeFile(path.join(cwd, "bunfig.toml"), "[fmt]\nsemi=true\n");
  const configuration = new BunConfiguration(runner, () => global);
  const file = path.join(cwd, "x.ts");
  expect(
    (await configuration.resolve(runtime, "fmt", cwd, file)).prefix,
  ).toEqual([]);
  expect(
    await new Formatter(runner, configuration).format(
      runtime,
      cwd,
      file,
      'const x="hello";',
    ),
  ).toBe('const x = "hello";\n');
  expect((await configuration.resolve(runtime, "lint", cwd, file)).source).toBe(
    "global",
  );
});
test("local lint leaves global formatting available", async () => {
  const cwd = await project("split-lint");
  const global = path.join(cwd, "global.toml");
  await writeFile(
    global,
    '[fmt]\nsemi=false\n[lint.rules]\n"no-console"="error"\n',
  );
  await writeFile(
    path.join(cwd, "bunfig.toml"),
    '[lint.rules]\n"no-console"="off"\n',
  );
  const configuration = new BunConfiguration(runner, () => global);
  const file = path.join(cwd, "x.ts");
  expect((await configuration.resolve(runtime, "fmt", cwd, file)).source).toBe(
    "global",
  );
  const selected = await configuration.resolve(runtime, "lint", cwd, file);
  expect(selected.source).toBe("local");
  expect(selected.prefix).toEqual([]);
  expect(
    (
      await new Linter(runner, configuration).run(runtime, cwd, [file], {
        input: "console.log(1)",
      })
    )[0].messages,
  ).toEqual([]);
});
test("nested sections and multi-root files resolve independently", async () => {
  const a = await project("root a"),
    b = await project("root b");
  const nested = path.join(a, "package");
  await mkdir(nested);
  await writeFile(path.join(a, "bunfig.toml"), "[fmt]\nsemi=false\n");
  await writeFile(
    path.join(nested, "bunfig.toml"),
    '[lint.rules]\n"no-console"="off"\n',
  );
  await writeFile(path.join(b, "bunfig.toml"), "[fmt]\nsemi=true\n");
  const configuration = new BunConfiguration(runner, () => "");
  expect(
    (await configuration.resolve(runtime, "fmt", a, path.join(nested, "x.ts")))
      .cwd,
  ).toBe(a);
  expect(
    (await configuration.resolve(runtime, "lint", a, path.join(nested, "x.ts")))
      .cwd,
  ).toBe(nested);
  const formatter = new Formatter(runner, configuration);
  expect(
    await formatter.format(runtime, a, path.join(nested, "x.ts"), "const x=1;"),
  ).toBe("const x = 1\n");
  expect(
    await formatter.format(runtime, b, path.join(b, "x.ts"), "const x=1"),
  ).toBe("const x = 1;\n");
});
test("missing sections select defaults; comments and strings are not sections", async () => {
  const cwd = await project("default");
  const global = path.join(cwd, "global.toml");
  await writeFile(global, '# [fmt]\ntext="[lint]"\n');
  const configuration = new BunConfiguration(runner, () => global);
  expect((await configuration.resolve(runtime, "fmt", cwd)).source).toBe(
    "default",
  );
  expect((await configuration.resolve(runtime, "lint", cwd)).source).toBe(
    "default",
  );
  expect(
    (
      await new BunConfiguration(runner, () =>
        path.join(cwd, "missing.toml"),
      ).resolve(runtime, "fmt", cwd)
    ).source,
  ).toBe("default");
  expect(new BunConfiguration(runner).globalFile(cwd)).toBe(
    path.join(os.homedir(), ".config", "bun", "bunfig.toml"),
  );
});
test("edits invalidate parsed sections and malformed TOML fails visibly", async () => {
  const cwd = await project("reload");
  const global = path.join(cwd, "global.toml");
  const configuration = new BunConfiguration(runner, () => global);
  await writeFile(global, "[fmt]\nsemi=false\n");
  expect((await configuration.resolve(runtime, "lint", cwd)).source).toBe(
    "default",
  );
  await writeFile(global, '[lint.rules]\n"no-console"="error"\n');
  expect((await configuration.resolve(runtime, "lint", cwd)).source).toBe(
    "global",
  );
  await writeFile(global, "[fmt\n");
  await expect(configuration.resolve(runtime, "fmt", cwd)).rejects.toThrow(
    "Cannot parse Bun configuration",
  );
});
test("workspace lint batches nested projects by their own native configuration", async () => {
  const cwd = await project("workspace");
  const nested = path.join(cwd, "nested");
  await mkdir(nested);
  const global = path.join(cwd, "global.toml");
  await writeFile(global, '[lint.rules]\n"no-console"="error"\n');
  await writeFile(
    path.join(nested, "bunfig.toml"),
    '[lint.rules]\n"no-console"="off"\n',
  );
  await writeFile(path.join(cwd, "root.ts"), "console.log(1)");
  await writeFile(path.join(nested, "child.ts"), "console.log(2)");
  const reports = await new Linter(
    runner,
    new BunConfiguration(runner, () => global),
  ).run(runtime, cwd, ["."]);
  expect(
    reports
      .find((report) => report.filePath.endsWith("root.ts"))!
      .messages.some((message) => message.ruleId === "no-console"),
  ).toBe(true);
  expect(
    reports.find((report) => report.filePath.endsWith("child.ts"))!.messages,
  ).toEqual([]);
});

test("TOML parsing isolates ambient preload and removes private directories on success and failure", async () => {
  const ambient = await project("ambient-preload");
  const marker = path.join(ambient, "preload-executed");
  await writeFile(
    path.join(ambient, "bunfig.toml"),
    'preload = ["./preload.ts"]\n',
  );
  await writeFile(
    path.join(ambient, "preload.ts"),
    `await Bun.write(${JSON.stringify(marker)}, "executed");`,
  );
  const parser = path.resolve(
    import.meta.dir,
    "../src/configuration/bunfig.ts",
  );
  const runnerModule = path.resolve(import.meta.dir, "../src/bun/runner.ts");
  const script = `
    import { BunConfiguration } from ${JSON.stringify(parser)};
    import { Runner } from ${JSON.stringify(runnerModule)};
    import { writeFile, readdir, access } from "node:fs/promises";
    import path from "node:path";
    const ambient = ${JSON.stringify(ambient)};
    const file = path.join(ambient, "input.toml");
    const runner = new Runner();
    try {
      const configuration = new BunConfiguration(runner);
      await writeFile(file, "[fmt]\\nsemi=false\\n");
      const keys = await configuration.sections({ path: process.execPath }, file);
      if (JSON.stringify(keys) !== '["fmt"]') throw new Error("Wrong TOML sections");
      await writeFile(file, "[invalid");
      try {
        await configuration.sections({ path: process.execPath }, file);
        throw new Error("Invalid TOML was accepted");
      } catch (error) {
        if (!String(error).includes("Cannot parse Bun configuration")) throw error;
      }
      await writeFile(file, "[lint]\\n");
      try {
        await configuration.sections({ path: path.join(ambient, "missing-bun") }, file);
        throw new Error("Missing executable was accepted");
      } catch (error) {
        if (String(error).includes("was accepted")) throw error;
      }
      if ((await readdir(ambient)).some(name => name.startsWith("bun-tools-toml-")))
        throw new Error("Private directory was not removed");
      try {
        await access(${JSON.stringify(marker)});
        throw new Error("Ambient preload executed");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    } finally { runner.dispose(); }
  `;
  const child = Bun.spawn(
    [runtime.path, "--no-install", "--no-env-file", "-e", script],
    {
      cwd: root,
      env: { ...process.env, TMPDIR: ambient, TMP: ambient, TEMP: ambient },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stderr = await new Response(child.stderr).text();
  expect({ code: await child.exited, stderr }).toEqual({ code: 0, stderr: "" });
});
