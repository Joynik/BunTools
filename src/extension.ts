import * as vscode from "vscode";
import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { Discovery, type Runtime } from "./bun/discovery";
import { Runner } from "./bun/runner";
import {
  Formatter,
  languages,
  supportedFile,
  djangoHtml,
} from "./formatter/core";
import { FormattingProvider } from "./formatter/provider";
import { Linter } from "./linter/core";
import { LintService, lintSelector, fixAllKind } from "./linter/service";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Bun Tools");
  const runner = new Runner(2);
  const discovery = new Discovery(runner);
  const formatter = new Formatter(runner);
  const notified = new Set<string>();
  const log = (
    message: string,
    level: "error" | "warn" | "info" | "debug" = "info",
  ) => {
    const levels = ["error", "warn", "info", "debug"];
    const setting = vscode.workspace
      .getConfiguration("bunTools")
      .get<string>("output.logLevel", "info");
    if (levels.indexOf(level) <= levels.indexOf(setting))
      output.appendLine(`[${level}] ${message}`);
  };
  const reportError = (message: string) => {
    log(message, "error");
    if (!notified.has(message)) {
      notified.add(message);
      void vscode.window
        .showWarningMessage(`Bun Tools: ${message}`, "Show Output")
        .then((choice) => {
          if (choice) output.show();
        });
    }
  };
  const linter = new Linter(runner);
  const lintService = new LintService(discovery, linter, reportError);
  const provider = new FormattingProvider(discovery, formatter, reportError);
  const selector: vscode.DocumentSelector = Object.keys(languages).flatMap(
    (language) => [
      { language, scheme: "file" },
      { language, scheme: "untitled" },
    ],
  );
  context.subscriptions.push(
    output,
    runner,
    provider,
    lintService,
    vscode.languages.registerCodeActionsProvider(lintSelector, lintService, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, fixAllKind],
    }),
    vscode.commands.registerCommand(
      "bunTools.applyFix",
      (uri: string, version: number, fix: import("./linter/core").Fix) =>
        lintService.applyFix(uri, version, fix),
    ),
    vscode.languages.registerDocumentFormattingEditProvider(selector, provider),
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      selector.filter(
        (item) =>
          typeof item === "object" &&
          [
            "javascript",
            "javascriptreact",
            "typescript",
            "typescriptreact",
          ].includes(item.language ?? ""),
      ),
      provider,
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length) provider.cancel(event.document.uri);
    }),
    vscode.workspace.onDidCloseTextDocument((document) =>
      provider.cancel(document.uri),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("bunTools")) restart();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => restart()),
  );
  function restart() {
    provider.dispose();
    runner.cancelAll();
    discovery.clear();
    lintService.refresh();
    notified.clear();
    log("Runtime cache cleared. Bun will be discovered on the next request.");
  }
  async function chooseFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) return folders[0];
    if (!folders.length) {
      void vscode.window.showInformationMessage(
        "Bun Tools: Open a workspace folder first.",
      );
      return;
    }
    const selected = await vscode.window.showQuickPick(
      folders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder,
      })),
      { placeHolder: "Select the Bun project" },
    );
    return selected?.folder;
  }
  async function runtimeFor(resource?: vscode.Uri): Promise<Runtime> {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust the workspace before running Bun.");
    return discovery.get({
      folder: resource
        ? vscode.workspace.getWorkspaceFolder(resource)?.uri.fsPath
        : undefined,
      explicit: vscode.workspace
        .getConfiguration("bunTools", resource)
        .get<string>("bunPath"),
    });
  }
  function dirtyIn(folder: vscode.WorkspaceFolder): boolean {
    return vscode.workspace.textDocuments.some(
      (document) =>
        document.isDirty &&
        vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() ===
          folder.uri.toString(),
    );
  }
  let workspaceBusy = false;
  async function workspaceFormat(check: boolean) {
    const folder = await chooseFolder();
    if (!folder) return;
    if (!check && dirtyIn(folder))
      throw new Error(
        "Save or close unsaved documents in this workspace before formatting it.",
      );
    if (check && dirtyIn(folder))
      void vscode.window.showInformationMessage(
        "Bun Tools: Check Formatting checks saved files. Unsaved editor changes are not included.",
      );
    const runtime = await runtimeFor(folder.uri);
    if (!runtime.format)
      throw new Error(
        `Bun ${runtime.version} does not provide the required native formatter. Install Bun 1.4.4 or newer.`,
      );
    if (workspaceBusy)
      throw new Error(
        "A workspace formatting operation is already running. Cancel it or wait for completion.",
      );
    workspaceBusy = true;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: check ? "Bun: Check Formatting" : "Bun: Format Workspace",
          cancellable: true,
        },
        async (progress, token) => {
          const controller = new AbortController();
          const subscription = token.onCancellationRequested(() =>
            controller.abort(),
          );
          const edits = vscode.workspace.onDidChangeTextDocument((event) => {
            if (!check && event.document.isDirty && dirtyIn(folder))
              controller.abort();
          });
          const cwd = folder.uri.fsPath;
          const signal = controller.signal;
          let processed = 0;
          try {
            const list = await runner.run(
              runtime.path,
              ["fmt", "--no-script", "--list-files", "."],
              { cwd, signal, timeout: 120000 },
            );
            if (list.code !== 0)
              throw new Error(
                "Bun could not enumerate workspace files. Check project formatter configuration.",
              );
            const root = await realpath(cwd);
            const files: string[] = [];
            for (const name of list.stdout.split(/\r?\n/).filter(Boolean)) {
              signal.throwIfAborted();
              const file = path.resolve(cwd, name);
              if (!supportedFile(file)) continue;
              const canonical = await realpath(file);
              const relative = path.relative(root, canonical);
              if (
                relative.startsWith(`..${path.sep}`) ||
                relative === ".." ||
                path.isAbsolute(relative)
              )
                continue;
              if (
                /\.html?$/i.test(file) &&
                djangoHtml(file, await readFile(file, "utf8"))
              )
                continue;
              if ((await stat(file)).isFile()) files.push(file);
            }
            const uniqueFiles = [...new Set(files)];
            let different = false;
            for (let index = 0; index < uniqueFiles.length; index += 30) {
              signal.throwIfAborted();
              if (!check && dirtyIn(folder))
                throw new Error(
                  "An editor has unsaved changes. Workspace formatting stopped; earlier batches may have completed.",
                );
              const batch = uniqueFiles.slice(index, index + 30);
              await formatter.ensureNative(runtime, cwd, batch, signal);
              // The doctor may take time. Recheck dirty editors immediately before writing.
              if (!check && dirtyIn(folder))
                throw new Error(
                  "An editor has unsaved changes. Workspace formatting stopped.",
                );
              const result = await runner.run(
                runtime.path,
                ["fmt", "--no-script", ...(check ? ["--check"] : []), ...batch],
                { cwd, signal, timeout: 120000 },
              );
              if (result.code > (check ? 1 : 0) || result.code < 0)
                throw new Error(
                  `Bun workspace formatting failed (${result.code}). Earlier batches may have completed.`,
                );
              if (result.code === 1) different = true;
              // Bun prints paths and summaries on stdout. Do not log stderr source excerpts.
              if (result.stdout) log(result.stdout.trim());
              processed += batch.length;
              progress.report({
                message: `${processed}/${uniqueFiles.length} files`,
                increment: (batch.length / uniqueFiles.length) * 100,
              });
            }
            const summary = check
              ? `Checked ${processed} saved files. ${different ? "Formatting changes are needed." : "Formatting is current."}`
              : `Formatted ${processed} files. Bun ignore rules and supported language exclusions applied.`;
            log(summary);
            void vscode.window.showInformationMessage(`Bun Tools: ${summary}`);
          } catch (error) {
            if (signal.aborted) {
              log(
                `Workspace operation cancelled after ${processed} files. Completed edits remain on disk.`,
                "warn",
              );
              void vscode.window.showInformationMessage(
                "Bun Tools: Cancelled. Completed workspace edits remain on disk.",
              );
            } else throw error;
          } finally {
            subscription.dispose();
            edits.dispose();
          }
        },
      );
    } finally {
      workspaceBusy = false;
    }
  }
  async function workspaceLint(fix: boolean) {
    const folder = await chooseFolder();
    if (!folder) return;
    const runtime = await runtimeFor(folder.uri);
    if (!runtime.lint) throw new Error(runtime.lintReason);
    if (fix && !runtime.fixes)
      throw new Error("This Bun has no verified fix support.");
    if (workspaceBusy)
      throw new Error("Another workspace operation is already running.");
    if (fix && dirtyIn(folder))
      throw new Error(
        "Save or close unsaved documents before fixing the workspace.",
      );
    workspaceBusy = true;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: fix ? "Bun: Fix Workspace" : "Bun: Lint Workspace",
          cancellable: true,
        },
        async (_progress, token) => {
          const controller = new AbortController();
          const cancellation = token.onCancellationRequested(() =>
            controller.abort(),
          );
          const changed = vscode.workspace.onDidChangeTextDocument((event) => {
            if (fix && event.document.isDirty && dirtyIn(folder))
              controller.abort();
          });
          const versions = new Map(
            vscode.workspace.textDocuments.map((document) => [
              document.uri.toString(),
              document.version,
            ]),
          );
          try {
            if (!fix && dirtyIn(folder))
              void vscode.window.showInformationMessage(
                "Bun Tools: Workspace lint checks saved files. Dirty documents keep their editor diagnostics.",
              );
            const reports = await linter.run(
              runtime,
              folder.uri.fsPath,
              ["."],
              {
                fix,
                write: fix,
                signal: controller.signal,
                typeAware: vscode.workspace
                  .getConfiguration("bunTools", folder.uri)
                  .get("lint.typeAware", false),
              },
            );
            lintService.clearWorkspace(folder);
            lintService.publishWorkspace(reports, folder, versions);
            if (fix) lintService.refresh();
            const count = reports.reduce(
              (sum, report) => sum + report.messages.length,
              0,
            );
            log(
              `${fix ? "Fixed" : "Linted"} ${reports.length} files; ${count} remaining problems.`,
            );
            void vscode.window.showInformationMessage(
              `Bun Tools: ${fix ? "Fixed" : "Linted"} ${reports.length} files; ${count} remaining problems.`,
            );
          } catch (error) {
            if (controller.signal.aborted)
              void vscode.window.showInformationMessage(
                "Bun Tools: Cancelled. Completed workspace fixes remain on disk.",
              );
            else throw error;
          } finally {
            cancellation.dispose();
            changed.dispose();
          }
        },
      );
    } finally {
      workspaceBusy = false;
    }
  }
  const command = (name: string, handler: () => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(`bunTools.${name}`, async () => {
        try {
          return await handler();
        } catch (error) {
          reportError(String(error));
        }
      }),
    );
  command("formatWorkspace", () => workspaceFormat(false));
  command("checkFormatting", () => workspaceFormat(true));
  command("lintWorkspace", () => workspaceLint(false));
  command("fixWorkspace", () => workspaceLint(true));
  command("fixCurrentFile", () => lintService.fixCurrent());
  command("restart", restart);
  command("showOutput", () => output.show());
  command("showRuntimeInfo", async () => {
    const folder = vscode.workspace.workspaceFolders?.length
      ? await chooseFolder()
      : undefined;
    if (vscode.workspace.workspaceFolders?.length && !folder) return;
    const runtime = await runtimeFor(folder?.uri);
    const info = {
      executable: runtime.path,
      version: runtime.version,
      revision: runtime.revision,
      workspace: folder?.uri.fsPath ?? "(no workspace)",
      documentFormatting: runtime.format,
      selectionFormatting:
        runtime.format && runtime.range
          ? ["javascript", "javascriptreact", "typescript", "typescriptreact"]
          : [],
      languages: Object.keys(languages),
      nativeLintAdvertised: runtime.nativeLintAdvertised,
      diagnostics: runtime.lint,
      fixes: runtime.fixes,
      typeAware: runtime.typeAware,
      lintReason: runtime.lintReason,
      configuration:
        "Bun resolves bunfig.toml, .editorconfig and supported formatter configs from the project cwd and source path.",
    };
    log(JSON.stringify(info, null, 2));
    output.show();
    return info;
  });
  log("Ready. Select Bun Formatter & Linter using Format Document With…");
  // Public testable API; no additional executable commands or engine.
  return { runtimeFor };
}

export function deactivate() {
  /* VS Code disposes context subscriptions, including all child processes. */
}
