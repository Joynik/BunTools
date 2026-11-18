import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { defineConfig } from "@vscode/test-cli";

const generated = mkdtempSync(path.join(os.tmpdir(), "bun-tools-cli-"));
process.once("exit", () => rmSync(generated, { recursive: true, force: true }));
execFileSync("bun", [
    "build",
    "scripts/host-fixture.ts",
    "--target=node",
    "--format=esm",
    `--outfile=${path.join(generated, "host-fixture.mjs")}`,
]);
const { prepareHost } = await import(pathToFileURL(path.join(generated, "host-fixture.mjs")).href);
const { temp, workspace } = await prepareHost();
process.once("exit", () => rmSync(temp, { recursive: true, force: true }));
execFileSync("bun", [
    "build",
    "tests/host.ts",
    "--target=node",
    "--format=cjs",
    "--external=vscode",
    "--outfile=dist/host-test.cjs",
]);

export default defineConfig({
    files: "tests/vscode/host.test.cjs",
    workspaceFolder: workspace,
    ...(process.env.VSCODE_EXECUTABLE_PATH || process.platform === "darwin"
        ? {
              useInstallation: {
                  fromPath:
                      process.env.VSCODE_EXECUTABLE_PATH ||
                      "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
              },
          }
        : {}),
    env: { BUN_TOOLS_TEST_ROOT: temp, ELECTRON_RUN_AS_NODE: "" },
    launchArgs: [
        "--disable-workspace-trust",
        "--disable-gpu",
        "--user-data-dir",
        path.join(temp, "profile"),
        "--extensions-dir",
        path.join(temp, "extensions"),
    ],
    mocha: { timeout: 120000 },
});
