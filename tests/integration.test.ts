import { beforeAll, afterAll, test, expect } from "bun:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Discovery, type Runtime } from "../src/bun/discovery";
import { Runner } from "../src/bun/runner";
import {
  Formatter,
  minimalEdit,
  languages,
  supportedFile,
  djangoHtml,
} from "../src/formatter/core";

const runner = new Runner();
const discovery = new Discovery(runner);
const formatter = new Formatter(runner);
let cwd: string;
let runtime: Runtime;
beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "bun tools integration "));
  runtime = await discovery.get({});
  expect(runtime.format).toBe(true);
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      scripts: {
        fmt: "echo BAD_SCRIPT > SCRIPT_RAN",
        lint: "echo BAD_SCRIPT > SCRIPT_RAN",
      },
    }),
  );
});
afterAll(async () => {
  runner.dispose();
  await rm(cwd, { recursive: true, force: true });
});

for (const [language, extension] of Object.entries(languages)) {
  test(`real Bun formats unsaved ${language} text without changing the file`, async () => {
    const source = await readFile(
      new URL(`./fixtures/sample${extension}`, import.meta.url),
      "utf8",
    );
    const file = path.join(cwd, `a file${extension}`);
    const saved = language === "json" ? "{}" : source;
    await writeFile(file, saved);
    const output = await formatter.format(runtime, cwd, file, source);
    expect(output).not.toBe(source);
    expect(output.length).toBeGreaterThan(0);
    expect(await formatter.format(runtime, cwd, file, output)).toBe(output);
    expect(await readFile(file, "utf8")).toBe(saved);
    const edit = minimalEdit(source, output)!;
    expect(
      source.slice(0, edit.start) + edit.text + source.slice(edit.end),
    ).toBe(output);
  });
}
test("config uses workspace cwd, stdin file overrides, and EditorConfig", async () => {
  const project = path.join(cwd, "configured");
  await mkdir(project);
  await writeFile(
    path.join(project, "bunfig.toml"),
    "[fmt]\nsemi = false\nsingleQuote = true\n",
  );
  const output = await formatter.format(
    runtime,
    project,
    path.join(project, "unsaved.ts"),
    'const x = "hello";',
  );
  expect(output).toBe("const x = 'hello'\n");
  await writeFile(
    path.join(project, ".editorconfig"),
    "root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = crlf\n",
  );
  const nested = await formatter.format(
    runtime,
    project,
    path.join(project, "unsaved.ts"),
    'if(true){console.log("😀");}',
  );
  expect(nested).toContain("    console");
  expect(nested).toContain("\r\n");
});
test("selection formatting changes selected syntax nodes and uses UTF-16 offsets", async () => {
  const input = 'const emoji="😀";\nconst x={a:1};\nconst untouched={b:2};\n';
  const start = input.indexOf("const x");
  const end = input.indexOf("const untouched");
  const output = await formatter.format(
    runtime,
    cwd,
    path.join(cwd, "selection.ts"),
    input,
    undefined,
    { start, end },
  );
  expect(output).toStartWith('const emoji="😀";\n');
  expect(output).toContain("const x = { a: 1 };");
  expect(output).toEndWith("const untouched={b:2};\n");
});
test("syntax errors return no output edit and never modify original", async () => {
  const file = path.join(cwd, "broken.ts");
  await writeFile(file, "const = ;");
  await expect(
    formatter.format(runtime, cwd, file, "const = ;"),
  ).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("const = ;");
});
test("multi-root discovery, explicit binary, symlinks, and cache invalidation", async () => {
  const a = path.join(cwd, "root a"),
    b = path.join(cwd, "root b");
  await mkdir(path.join(a, ".bun", "bin"), { recursive: true });
  await mkdir(b);
  const local = path.join(
    a,
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  if (process.platform !== "win32") {
    await symlink(runtime.path, local);
    expect((await discovery.get({ folder: a })).path).toBe(runtime.path);
  }
  expect(
    (await discovery.get({ folder: b, explicit: runtime.path })).version,
  ).toBe(runtime.version);
  discovery.clear();
  expect((await discovery.get({ explicit: runtime.path })).path).toBe(
    runtime.path,
  );
});
test("workspace ignore and check mode do not write, and script overrides never run", async () => {
  const project = path.join(cwd, "workspace");
  await mkdir(project);
  await writeFile(path.join(project, ".gitignore"), "ignored.js\n");
  await writeFile(path.join(project, "included.js"), "const x={a:1};");
  await writeFile(path.join(project, "ignored.js"), "const x={a:1};");
  const list = await runner.run(
    runtime.path,
    ["fmt", "--no-script", "--list-files", "."],
    { cwd: project },
  );
  expect(list.stdout).toContain("included.js");
  expect(list.stdout).not.toContain("ignored.js");
  const check = await runner.run(
    runtime.path,
    ["fmt", "--no-script", "--check", "."],
    { cwd: project },
  );
  expect(check.code).toBe(1);
  expect(await readFile(path.join(project, "included.js"), "utf8")).toBe(
    "const x={a:1};",
  );
  expect(await Bun.file(path.join(cwd, "SCRIPT_RAN")).exists()).toBe(false);
  expect(typeof runtime.lint).toBe("boolean");
});
test("rejects external formatter delegation without calling external engine", async () => {
  const project = path.join(cwd, "plugins");
  await mkdir(project);
  await writeFile(
    path.join(project, ".prettierrc"),
    '{"plugins":["prettier-plugin-astro"]}',
  );
  await writeFile(path.join(project, "index.astro"), "<h1>Hello</h1>");
  const inspection = await runner.run(
    runtime.path,
    ["fmt", "--no-script", "--doctor", "--format=json", "."],
    { cwd: project },
  );
  const report = JSON.parse(inspection.stdout);
  // Missing external plugins are not installed by doctor and never used for document formatting.
  expect(report.plugins.not_installed.length).toBeGreaterThan(0);
  expect(supportedFile("index.astro")).toBe(false);
});

test("JSONC language override preserves comments for VS Code settings.json", async () => {
  const file = path.join(cwd, "settings.json");
  const input = '{// editor options\n"editor.fontSize":14,\n}';
  await writeFile(file, "{}");
  const output = await formatter.format(
    runtime,
    cwd,
    file,
    input,
    undefined,
    undefined,
    "jsonc",
  );
  expect(output).toContain("// editor options");
  expect(output).toContain('"editor.fontSize": 14');
  expect(await readFile(file, "utf8")).toBe("{}");
});
