import { readFile, writeFile } from "node:fs/promises";

const bump =
  process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "patch";
if (!["patch", "minor", "major"].includes(bump))
  throw new Error("Usage: bun run release [patch|minor|major] [--dry-run]");
const originalPackage = await readFile("package.json", "utf8");
const originalChangelog = await readFile("CHANGELOG.md", "utf8");
const manifest = JSON.parse(originalPackage);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error("Release version must be major.minor.patch.");
const parts = manifest.version.split(".").map(Number);
const index = { major: 0, minor: 1, patch: 2 }[
  bump as "major" | "minor" | "patch"
];
parts[index]++;
for (let lower = index + 1; lower < parts.length; lower++) parts[lower] = 0;
const version = parts.join(".");
if (!originalChangelog.split("## Unreleased")[1]?.split(/\n## /)[0]?.trim())
  throw new Error("Add release notes under ## Unreleased before releasing.");
if (process.argv.includes("--dry-run")) {
  console.log(
    `${manifest.version} → ${version}; artifact: ${manifest.name}-${version}.vsix`,
  );
} else {
  const run = async (script: string) => {
    const child = Bun.spawn([process.execPath, "run", script], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error(`${script} failed.`);
  };
  await run("typecheck");
  await run("test");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  try {
    manifest.version = version;
    await writeFile("package.json", JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(
      "CHANGELOG.md",
      originalChangelog.replace(
        "## Unreleased",
        `## Unreleased\n\n## ${version} — ${date}`,
      ),
    );
    await run("package");
    console.log(
      `Release ${version} is ready. No commit, tag, push or publication was performed.`,
    );
  } catch (error) {
    await writeFile("package.json", originalPackage);
    await writeFile("CHANGELOG.md", originalChangelog);
    throw error;
  }
}
