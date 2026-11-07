import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";

export async function run() {
    const extension = vscode.extensions.getExtension("kira.bun-tools");
    assert.ok(extension, "Extension must be installed in development host");
    await extension.activate();
    const folders = vscode.workspace.workspaceFolders!;
    assert.equal(folders.length, 2);
    let checks = 0;
    const check = (label: string) => {
        checks++;
        console.log(`HOST PASS: ${label}`);
    };
    const format = (document: vscode.TextDocument) =>
        vscode.commands.executeCommand<vscode.TextEdit[]>(
            "vscode.executeFormatDocumentProvider",
            document.uri,
            { tabSize: 2, insertSpaces: true },
        );
    const apply = async (
        document: vscode.TextDocument,
        edits: vscode.TextEdit[],
    ) => {
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, edits);
        assert.ok(await vscode.workspace.applyEdit(edit));
    };
    const a = path.join(folders[0].uri.fsPath, "unsaved.ts");
    await writeFile(a, "export const value = 1\n");
    const doc = await vscode.workspace.openTextDocument(a);
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        doc.uri,
        new vscode.Range(0, 0, doc.lineCount, 0),
        'export const value={message:"😀"};\n',
    );
    await vscode.workspace.applyEdit(edit);
    assert.ok(doc.isDirty);
    const edits = await format(doc);
    assert.ok(edits?.length);
    assert.equal(await readFile(a, "utf8"), "export const value = 1\n");
    await apply(doc, edits);
    assert.equal(doc.getText(), 'export const value = { message: "😀" }\n');
    check("provider formats current unsaved content without writing source");
    const languageStatus = extension.exports
        .languageStatus as vscode.LanguageStatusItem;
    const statusDeadline = Date.now() + 5000;
    while (languageStatus.busy && Date.now() < statusDeadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(languageStatus.text, "Bun Formatter & Linter");
    assert.ok(vscode.languages.match(languageStatus.selector, doc));
    assert.ok(languageStatus.detail?.includes("Default formatter"));
    assert.equal(languageStatus.command?.command, "bunTools.showRuntimeInfo");
    check(
        "Bun registers a language status entry with configured-default state",
    );
    assert.equal((await format(doc))?.length ?? 0, 0);
    check("unchanged document yields no edits");
    const next = new vscode.WorkspaceEdit();
    next.replace(
        doc.uri,
        new vscode.Range(0, 0, doc.lineCount, 0),
        "export const saved={x:2};\n",
    );
    await vscode.workspace.applyEdit(next);
    assert.ok(await doc.save());
    assert.equal(await readFile(a, "utf8"), "export const saved = { x: 2 }\n");
    check("standard VS Code format on save uses Bun provider");
    const b = path.join(folders[1].uri.fsPath, "other.ts");
    await writeFile(b, "export const other={x:1}");
    const other = await vscode.workspace.openTextDocument(b);
    await apply(other, (await format(other))!);
    assert.equal(other.getText(), "export const other = { x: 1 };\n");
    check("multi-root selects the matching bunfig.toml");
    await other.save();
    const rangeFile = path.join(folders[0].uri.fsPath, "range.ts");
    await writeFile(
        rangeFile,
        'const emoji="😀";\nconst x={a:1};\nconst tail={b:2};\n',
    );
    const rangeDoc = await vscode.workspace.openTextDocument(rangeFile);
    const rangeEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        "vscode.executeFormatRangeProvider",
        rangeDoc.uri,
        new vscode.Range(1, 0, 1, 14),
        { tabSize: 2, insertSpaces: true },
    );
    assert.ok(rangeEdits?.length);
    await apply(rangeDoc, rangeEdits);
    assert.ok(rangeDoc.getText().startsWith('const emoji="😀";\n'));
    assert.ok(rangeDoc.getText().endsWith("const tail={b:2};\n"));
    check("selection formatter preserves surrounding statements");
    // Disable format-on-save for the remaining tests; no project config is modified.
    await vscode.workspace
        .getConfiguration("editor")
        .update("formatOnSave", false, vscode.ConfigurationTarget.Workspace);
    await rangeDoc.save();
    for (const [name, language, source] of [
        ["notes.md", "markdown", "#   Hello"],
        ["config.toml", "toml", "x=1"],
        ["template.html", "html", '{% extends "base.html" %}<p>{{x}}</p>'],
    ] as const) {
        const file = path.join(folders[0].uri.fsPath, name);
        await writeFile(file, source);
        const document = await vscode.workspace.openTextDocument(file);
        const result = await format(document);
        // Built-in Markdown/TOML providers may exist; Bun must never register for them.
        if (language === "html") assert.equal(result?.length ?? 0, 0);
        assert.equal(await readFile(file, "utf8"), source);
    }
    check("Django HTML stays untouched; Markdown and TOML are not written");
    await vscode.workspace
        .getConfiguration("bunTools", doc.uri)
        .update(
            "format.enable",
            false,
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
    const disabled = new vscode.WorkspaceEdit();
    disabled.replace(
        doc.uri,
        new vscode.Range(0, 0, doc.lineCount, 0),
        "const x={a:1};",
    );
    await vscode.workspace.applyEdit(disabled);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("editor.action.formatDocument");
    assert.equal(doc.getText(), "const x={a:1};");
    await vscode.workspace
        .getConfiguration("bunTools", doc.uri)
        .update(
            "format.enable",
            true,
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
    check("resource-scoped format setting works after configuration reload");
    await doc.save();
    const runtime = await extension.exports.runtimeFor(doc.uri);
    assert.ok(runtime.path);
    assert.ok(runtime.version);
    assert.equal(runtime.lint, true);
    const diagnostics = vscode.languages
        .getDiagnostics(doc.uri)
        .filter((item) => item.source === "Bun");
    assert.equal(diagnostics.length, 0);
    check("runtime capabilities are exposed and no fake Bun diagnostics exist");
    await vscode.commands.executeCommand("bunTools.restart");
    assert.equal(
        (await extension.exports.runtimeFor(doc.uri)).version,
        runtime.version,
    );
    check("restart rediscovers Bun");
    const lintFile = path.join(folders[0].uri.fsPath, "lint.ts");
    await writeFile(lintFile, "let count=1;\nconsole.log(count);\n");
    const lintDoc = await vscode.workspace.openTextDocument(lintFile);
    const bunDiagnostics = () =>
        vscode.languages
            .getDiagnostics(lintDoc.uri)
            .filter((item) => item.source === "Bun");
    const until = async (predicate: () => boolean, label: string) => {
        const deadline = Date.now() + 7000;
        while (!predicate() && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 20));
        assert.ok(predicate(), label);
    };
    await until(
        () => bunDiagnostics().some((item) => item.code === "prefer-const"),
        "diagnostics on open",
    );
    assert.equal(
        bunDiagnostics().find((item) => item.code === "prefer-const")!.range
            .start.character,
        4,
    );
    check("native JSON diagnostic appears on open with exact rule and range");
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        lintDoc.uri,
        new vscode.Range(0, 0, 0, 12),
        "quickfix",
    );
    const quick = actions?.find((action) =>
        action.title.startsWith("Bun: Fix"),
    );
    assert.ok(quick?.command);
    await vscode.commands.executeCommand(
        quick.command.command,
        ...(quick.command.arguments ?? []),
    );
    assert.ok(lintDoc.getText().startsWith("const count"));
    assert.equal(
        await readFile(lintFile, "utf8"),
        "let count=1;\nconsole.log(count);\n",
    );
    check("Quick Fix applies native fix to editor and preserves saved file");
    await vscode.commands.executeCommand(
        quick.command.command,
        ...(quick.command.arguments ?? []),
    );
    assert.ok(lintDoc.getText().startsWith("const count"));
    check("stale Quick Fix version is ignored");
    const replace = async (text: string) => {
        const change = new vscode.WorkspaceEdit();
        change.replace(
            lintDoc.uri,
            new vscode.Range(0, 0, lintDoc.lineCount, 0),
            text,
        );
        await vscode.workspace.applyEdit(change);
    };
    await replace('const text="😀"; let value=1;\nconsole.log(text,value);\n');
    assert.equal(bunDiagnostics().length, 0);
    await until(
        () => bunDiagnostics().some((item) => item.code === "prefer-const"),
        "diagnostics after debounce",
    );
    const position = bunDiagnostics().find(
        (item) => item.code === "prefer-const",
    )!.range.start.character;
    assert.equal(position, lintDoc.getText().indexOf("value="));
    check("onType diagnostics use UTF-16 columns and clear stale results");
    const all = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        lintDoc.uri,
        new vscode.Range(0, 0, lintDoc.lineCount, 0),
        "source.fixAll.bun",
    );
    const sourceAction = all?.find(
        (action) => action.title === "Fix all Bun problems",
    );
    assert.ok(sourceAction?.edit);
    await vscode.workspace.applyEdit(sourceAction.edit);
    assert.ok(lintDoc.getText().includes("const value"));
    check("source.fixAll.bun returns safe dry-run edits");
    await replace("let saved=2; console.log(saved);");
    await vscode.window.showTextDocument(lintDoc);
    await vscode.commands.executeCommand("bunTools.fixCurrentFile");
    assert.ok(lintDoc.getText().startsWith("const saved"));
    check("Fix Current File edits unsaved content through native dry-run");
    await vscode.workspace
        .getConfiguration("bunTools", lintDoc.uri)
        .update(
            "lint.fixOnSave",
            true,
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
    await replace("let onSave=3; console.log(onSave);");
    assert.ok(await lintDoc.save());
    assert.ok((await readFile(lintFile, "utf8")).startsWith("const onSave"));
    check("opt-in fixOnSave uses native safe fixes");
    await vscode.workspace
        .getConfiguration("bunTools", lintDoc.uri)
        .update(
            "lint.fixOnSave",
            false,
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
    await vscode.workspace
        .getConfiguration("bunTools", lintDoc.uri)
        .update(
            "lint.run",
            "onSave",
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
    await replace("debugger;");
    assert.equal(bunDiagnostics().length, 0);
    await lintDoc.save();
    await until(
        () => bunDiagnostics().some((item) => item.code === "no-debugger"),
        "onSave diagnostics",
    );
    check("onSave mode publishes diagnostics after saving");
    await vscode.workspace
        .getConfiguration("bunTools", lintDoc.uri)
        .update(
            "lint.run",
            "onType",
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
    await replace("debugger;");
    await replace("export const clean = 1;");
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(bunDiagnostics().length, 0);
    check("newer document versions cannot receive older lint results");
    await lintDoc.save();
    await vscode.window.showTextDocument(lintDoc);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    assert.equal(
        vscode.languages
            .getDiagnostics(lintDoc.uri)
            .filter((item) => item.source === "Bun").length,
        0,
    );
    check("closing a document clears Bun diagnostics");
    const changedFolders = new Promise<void>((resolve) => {
        const listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            listener.dispose();
            resolve();
        });
    });
    assert.ok(vscode.workspace.updateWorkspaceFolders(1, 1));
    await changedFolders;
    const workspaceFile = path.join(folders[0].uri.fsPath, "workspace.ts");
    await writeFile(workspaceFile, "export const workspace={a:1};");
    await vscode.commands.executeCommand("bunTools.checkFormatting");
    assert.equal(
        await readFile(workspaceFile, "utf8"),
        "export const workspace={a:1};",
    );
    check("Check Formatting command is read-only");
    await vscode.commands.executeCommand("bunTools.formatWorkspace");
    assert.equal(
        await readFile(workspaceFile, "utf8"),
        "export const workspace = { a: 1 }\n",
    );
    assert.equal(
        await readFile(path.join(folders[0].uri.fsPath, "notes.md"), "utf8"),
        "#   Hello",
    );
    assert.equal(
        await readFile(path.join(folders[0].uri.fsPath, "config.toml"), "utf8"),
        "x=1",
    );
    assert.equal(
        await readFile(
            path.join(folders[0].uri.fsPath, "template.html"),
            "utf8",
        ),
        '{% extends "base.html" %}<p>{{x}}</p>',
    );
    check(
        "Format Workspace command formats supported files and excludes specialized formats",
    );
    const workspaceLintFile = path.join(
        folders[0].uri.fsPath,
        "workspace-lint.ts",
    );
    await writeFile(
        workspaceLintFile,
        "let workspaceCount=1; console.log(workspaceCount);",
    );
    await vscode.commands.executeCommand("bunTools.lintWorkspace");
    assert.ok(
        vscode.languages
            .getDiagnostics(vscode.Uri.file(workspaceLintFile))
            .some(
                (item) => item.source === "Bun" && item.code === "prefer-const",
            ),
    );
    check("Lint Workspace publishes native Problems diagnostics");
    await vscode.commands.executeCommand("bunTools.fixWorkspace");
    assert.ok(
        (await readFile(workspaceLintFile, "utf8")).startsWith(
            "const workspaceCount",
        ),
    );
    check("Fix Workspace applies native safe fixes to saved files");
    const dirtyFile = path.join(folders[0].uri.fsPath, "dirty.ts");
    await writeFile(dirtyFile, "let dirty=1; console.log(dirty);");
    const dirtyDoc = await vscode.workspace.openTextDocument(dirtyFile);
    const dirtyEdit = new vscode.WorkspaceEdit();
    dirtyEdit.insert(dirtyDoc.uri, new vscode.Position(0, 0), "// unsaved\n");
    await vscode.workspace.applyEdit(dirtyEdit);
    await vscode.commands.executeCommand("bunTools.fixWorkspace");
    assert.equal(
        await readFile(dirtyFile, "utf8"),
        "let dirty=1; console.log(dirty);",
    );
    assert.ok(dirtyDoc.isDirty);
    assert.ok(dirtyDoc.getText().startsWith("// unsaved"));
    check(
        "Fix Workspace refuses dirty editors without overwriting user changes",
    );
    await dirtyDoc.save();
    await vscode.window.showTextDocument(dirtyDoc);
    const configInfo = await vscode.commands.executeCommand<any>(
        "bunTools.showRuntimeInfo",
    );
    assert.equal(configInfo.configuration.format.source, "local");
    assert.equal(configInfo.configuration.lint.source, "global");
    check("Runtime Info reports independent local fmt and global lint sources");
    await vscode.commands.executeCommand("workbench.action.openSettingsJson");
    const settingsDoc = vscode.window.activeTextEditor!.document;
    console.log(
        `HOST SETTINGS: scheme=${settingsDoc.uri.scheme}, language=${settingsDoc.languageId}`,
    );
    assert.equal(settingsDoc.languageId, "jsonc");
    assert.equal(settingsDoc.uri.scheme, "vscode-userdata");
    const savedSettings = await readFile(settingsDoc.uri.fsPath, "utf8");
    const settingsSource = '{// Keep this comment\n"editor.fontSize":14,\n}';
    const settingsEdit = new vscode.WorkspaceEdit();
    settingsEdit.replace(
        settingsDoc.uri,
        new vscode.Range(0, 0, settingsDoc.lineCount, 0),
        settingsSource,
    );
    await vscode.workspace.applyEdit(settingsEdit);
    await Promise.race([
        vscode.commands.executeCommand("editor.action.formatDocument"),
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error("Bun settings formatting timed out")),
                5000,
            ),
        ),
    ]);
    assert.notEqual(
        settingsDoc.getText(),
        settingsSource,
        "Bun must format the actual VS Code user settings document",
    );
    assert.ok(settingsDoc.getText().includes("// Keep this comment"));
    assert.ok(settingsDoc.getText().includes('"editor.fontSize": 14'));
    assert.equal(await readFile(settingsDoc.uri.fsPath, "utf8"), savedSettings);
    assert.ok(vscode.languages.match(languageStatus.selector, settingsDoc));
    check(
        "Bun formats actual vscode-userdata settings.json with comments without writing disk",
    );
    const globalSettingsChange = new vscode.WorkspaceEdit();
    globalSettingsChange.replace(
        settingsDoc.uri,
        new vscode.Range(0, 0, settingsDoc.lineCount, 0),
        '{\n"globalSetting":"hello"\n}',
    );
    await vscode.workspace.applyEdit(globalSettingsChange);
    await vscode.commands.executeCommand("editor.action.formatDocument");
    assert.ok(settingsDoc.getText().includes('\n    "globalSetting"'));
    const settingsInfo = await vscode.commands.executeCommand<any>(
        "bunTools.showRuntimeInfo",
    );
    assert.equal(settingsInfo.configuration.format.source, "global");
    check("User settings outside the project use the configured global file");
    console.log(`HOST RESULT: ${checks} checks passed`);
}
