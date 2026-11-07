import { runTests } from "@vscode/test-electron";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "bun-tools-host-"));
try {
  const folders = [path.join(temp, "project a"), path.join(temp, "project b")];
  for (const folder of folders) {
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, "package.json"),
      JSON.stringify({
        scripts: {
          fmt: "echo BAD_SCRIPT > SCRIPT_RAN",
          lint: "echo BAD_SCRIPT > SCRIPT_RAN",
        },
      }),
    );
  }
  await writeFile(
    path.join(folders[0], "bunfig.toml"),
    "[fmt]\nsemi = false\n",
  );
  await writeFile(path.join(folders[1], "bunfig.toml"), "[fmt]\nsemi = true\n");
  await writeFile(
    path.join(temp, "global.toml"),
    '[fmt]\nsemi=false\nsingleQuote=true\ntabWidth=4\n[lint.rules]\n"no-console"="error"\n',
  );
  const workspace = path.join(temp, "test.code-workspace");
  await writeFile(
    workspace,
    JSON.stringify({
      folders: folders.map((folder) => ({ path: folder })),
      settings: {
        "editor.defaultFormatter": "kira.bun-tools",
        "editor.formatOnSave": true,
        "files.autoSave": "off",
        "bunTools.globalConfigPath": path.join(temp, "global.toml"),
      },
    }),
  );
  const build = await Bun.build({
    entrypoints: [path.join(root, "tests/host.ts")],
    target: "node",
    format: "cjs",
    external: ["vscode"],
    outdir: path.join(root, "dist"),
    naming: "host-test.cjs",
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "dist/host-test.cjs"),
    ...(process.env.VSCODE_EXECUTABLE_PATH
      ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
      : process.platform === "darwin"
        ? {
            vscodeExecutablePath:
              "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
          }
        : {}),
    launchArgs: [
      workspace,
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--disable-gpu",
      "--user-data-dir",
      path.join(temp, "profile"),
      "--extensions-dir",
      path.join(temp, "extensions"),
    ],
    extensionTestsEnv: { BUN_TOOLS_TEST_ROOT: temp, ELECTRON_RUN_AS_NODE: "" },
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
