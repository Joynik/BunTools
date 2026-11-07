import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("release preview leaves files unchanged and packaging failure rolls version back", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "bun-release-test-"));
  const script = path.resolve("scripts/release.ts");
  const manifest = JSON.stringify({
    name: "fixture",
    version: "1.2.3",
    scripts: {
      typecheck: 'bun -e "process.exit(0)"',
      test: 'bun -e "process.exit(0)"',
      package: 'bun -e "process.exit(42)"',
    },
  });
  const changelog = "# Changelog\n\n## Unreleased\n\n- Test release.\n";
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, script, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  try {
    await writeFile(path.join(cwd, "package.json"), manifest);
    await writeFile(path.join(cwd, "CHANGELOG.md"), changelog);
    const preview = await run(["--dry-run"]);
    expect(preview.code).toBe(0);
    expect(preview.stdout).toContain("1.2.3 → 1.2.4");
    expect(await readFile(path.join(cwd, "package.json"), "utf8")).toBe(
      manifest,
    );
    expect((await run([])).code).not.toBe(0);
    expect(await readFile(path.join(cwd, "package.json"), "utf8")).toBe(
      manifest,
    );
    expect(await readFile(path.join(cwd, "CHANGELOG.md"), "utf8")).toBe(
      changelog,
    );
    await writeFile(
      path.join(cwd, "CHANGELOG.md"),
      "# Changelog\n\n## Unreleased\n",
    );
    expect((await run([])).code).not.toBe(0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
