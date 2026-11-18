import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function prepareHost() {
    const temp = await mkdtemp(path.join(os.tmpdir(), "bun-tools-host-"));
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
    await writeFile(path.join(folders[0], "bunfig.toml"), "[fmt]\nsemi = false\n");
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
    return { temp, workspace };
}
