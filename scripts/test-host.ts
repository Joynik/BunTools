import { rm } from "node:fs/promises";
import path from "node:path";

import { runTests } from "@vscode/test-electron";

import { prepareHost } from "./host-fixture";

const root = process.cwd();
const { temp, workspace } = await prepareHost();
try {
    const build = await Bun.build({
        entrypoints: [path.join(root, "tests/host.ts")],
        target: "node",
        format: "cjs",
        external: ["vscode"],
        outdir: path.join(root, "dist"),
        naming: "host-test.cjs",
    });
    if (!build.success) {
        throw new Error(build.logs.join("\n"));
    }
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
