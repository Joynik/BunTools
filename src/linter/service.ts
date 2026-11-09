import * as vscode from "vscode";
import path from "node:path";
import os from "node:os";
import type { Discovery, Runtime } from "../bun/discovery";
import {
  Linter,
  lintFile,
  type Fix,
  type Message,
  type LintFile,
} from "./core";
import { Scheduler } from "./scheduler";
import { minimalEdit } from "../formatter/core";

export const fixAllKind = vscode.CodeActionKind.SourceFixAll.append("bun");
const lintLanguages = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
];
export const lintSelector = lintLanguages.flatMap((language) => [
  { language, scheme: "file" },
  { language, scheme: "untitled" },
]);

export class LintService implements vscode.CodeActionProvider {
  readonly diagnostics = vscode.languages.createDiagnosticCollection("Bun");
  private scheduler = new Scheduler();
  private snapshots = new Map<
    string,
    {
      id: number;
      version: number;
      entries: { diagnostic: vscode.Diagnostic; fix?: Fix }[];
    }
  >();
  private subscriptions: vscode.Disposable[] = [];
  private nextSnapshotId = 0;
  private refreshSerial = 0;
  private globalVersion = 0;
  private rootVersions = new Map<string, number>();
  constructor(
    private discovery: Discovery,
    private linter: Linter,
    private error: (message: string) => void,
    private info: (message: string) => void,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) =>
        this.schedule(document, "open"),
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length)
          this.schedule(event.document, "change");
      }),
      vscode.workspace.onDidSaveTextDocument((document) =>
        this.schedule(document, "save"),
      ),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.scheduler.cancel(document.uri.toString());
        this.diagnostics.delete(document.uri);
        this.snapshots.delete(document.uri.toString());
      }),
      vscode.workspace.onWillSaveTextDocument((event) => {
        const config = vscode.workspace.getConfiguration(
          "bunTools",
          event.document.uri,
        );
        if (
          config.get("lint.enable", true) &&
          config.get("lint.fixOnSave", false) &&
          this.supported(event.document)
        )
          event.waitUntil(this.fixedEdits(event.document));
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("bunTools")) this.refresh();
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.isConfig(document.uri.fsPath))
          this.refresh(vscode.workspace.getWorkspaceFolder(document.uri));
      }),
    );
    // Configuration is read by each Bun process. Watch known config names, not source trees.
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/{bunfig.toml,.editorconfig,.prettierrc*,.prettierignore,.eslintignore,.oxfmtrc*,.oxlintrc*,eslint.config.*,.eslintrc*,tsconfig*.json,package.json,.gitignore}",
    );
    this.subscriptions.push(
      watcher,
      watcher.onDidChange((uri) =>
        this.refresh(vscode.workspace.getWorkspaceFolder(uri)),
      ),
      watcher.onDidCreate((uri) =>
        this.refresh(vscode.workspace.getWorkspaceFolder(uri)),
      ),
      watcher.onDidDelete((uri) =>
        this.refresh(vscode.workspace.getWorkspaceFolder(uri)),
      ),
    );
    for (const document of vscode.workspace.textDocuments)
      this.schedule(document, "open");
  }
  private isConfig(file: string) {
    return /^(bunfig\.toml|\.editorconfig|\.prettierrc.*|\.prettierignore|\.eslintignore|\.oxfmtrc.*|\.oxlintrc.*|eslint\.config\..*|\.eslintrc.*|tsconfig.*\.json|package\.json|\.gitignore)$/.test(
      path.basename(file),
    );
  }
  private supported(document: vscode.TextDocument): boolean {
    return (
      vscode.workspace.isTrusted &&
      lintLanguages.includes(document.languageId) &&
      ["file", "untitled"].includes(document.uri.scheme)
    );
  }
  private config(document: vscode.TextDocument) {
    return vscode.workspace.getConfiguration("bunTools", document.uri);
  }
  private async context(
    document: vscode.TextDocument,
  ): Promise<{ runtime: Runtime; cwd: string; file: string }> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri
      .fsPath;
    const cwd =
      folder ??
      (document.uri.scheme === "file"
        ? path.dirname(document.uri.fsPath)
        : os.homedir());
    const runtime = await this.discovery.get({
      folder,
      explicit: this.config(document).get<string>("bunPath"),
    });
    const extension = document.languageId.includes("typescript")
      ? document.languageId.endsWith("react")
        ? ".tsx"
        : ".ts"
      : document.languageId.endsWith("react")
        ? ".jsx"
        : ".js";
    return {
      runtime,
      cwd,
      file:
        document.uri.scheme === "file"
          ? document.uri.fsPath
          : path.join(cwd, `untitled${extension}`),
    };
  }
  schedule(document: vscode.TextDocument, trigger: "open" | "change" | "save") {
    const key = document.uri.toString();
    this.scheduler.cancel(key);
    // Clear stale diagnostics immediately, including pending Quick Fix snapshots.
    this.diagnostics.delete(document.uri);
    this.snapshots.delete(key);
    const config = this.config(document);
    if (!this.supported(document) || !config.get("lint.enable", true)) return;
    const run = config.get<string>("lint.run", "onType");
    if (run === "manual" || (trigger === "change" && run !== "onType")) return;
    const version = document.version;
    this.scheduler.schedule(
      key,
      trigger === "change" ? config.get<number>("lint.debounce", 400) : 0,
      async (signal) => {
        try {
          const { runtime, cwd, file } = await this.context(document);
          if (signal.aborted || !runtime.lint) return;
          const reports = await this.linter.run(runtime, cwd, [file], {
            input: document.getText(),
            typeAware: config.get("lint.typeAware", false),
            signal,
          });
          if (
            !signal.aborted &&
            !document.isClosed &&
            document.version === version
          )
            this.publish(
              document,
              reports.find(
                (report) =>
                  path.resolve(report.filePath) === path.resolve(file),
              )?.messages ?? [],
            );
        } catch (error) {
          if (!signal.aborted) this.error(`Lint failed: ${String(error)}`);
        }
      },
    );
  }
  private publish(document: vscode.TextDocument, messages: Message[]) {
    const entries = messages.map((message) => {
      const start = new vscode.Position(message.line - 1, message.column - 1);
      const end = new vscode.Position(
        (message.endLine ?? message.line) - 1,
        (message.endColumn ?? message.column + 1) - 1,
      );
      const diagnostic = new vscode.Diagnostic(
        document.validateRange(new vscode.Range(start, end)),
        message.message,
        message.severity === 2
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = "Bun";
      if (message.ruleId) diagnostic.code = message.ruleId;
      return { diagnostic, fix: message.fix };
    });
    this.snapshots.set(document.uri.toString(), {
      id: ++this.nextSnapshotId,
      version: document.version,
      entries,
    });
    this.diagnostics.set(
      document.uri,
      entries.map((entry) => entry.diagnostic),
    );
  }
  async fixedEdits(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    if (!this.supported(document)) return [];
    const version = document.version,
      source = document.getText();
    const controller = new AbortController();
    const subscription = token?.onCancellationRequested(() =>
      controller.abort(),
    );
    if (token?.isCancellationRequested) controller.abort();
    try {
      const { runtime, cwd, file } = await this.context(document);
      if (!runtime.fixes)
        throw new Error(
          runtime.lintReason || "Native lint fixes are unavailable.",
        );
      const reports = await this.linter.run(runtime, cwd, [file], {
        input: source,
        fix: true,
        typeAware: this.config(document).get("lint.typeAware", false),
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        document.isClosed ||
        document.version !== version
      )
        return [];
      const report = reports.find(
        (report) => path.resolve(report.filePath) === path.resolve(file),
      );
      if (report?.output === undefined) return [];
      const edit = minimalEdit(source, report.output);
      return edit
        ? [
            vscode.TextEdit.replace(
              new vscode.Range(
                document.positionAt(edit.start),
                document.positionAt(edit.end),
              ),
              edit.text,
            ),
          ]
        : [];
    } catch (error) {
      if (!controller.signal.aborted)
        this.error(`Fix failed: ${String(error)}`);
      return [];
    } finally {
      subscription?.dispose();
    }
  }
  async fixCurrent(document = vscode.window.activeTextEditor?.document) {
    if (!document) return;
    const edits = await this.fixedEdits(document);
    if (!edits.length) return;
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, edits);
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error("VS Code could not apply Bun fixes.");
  }
  async applyFix(uri: string, snapshotId: number, fix: Fix) {
    const document = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri,
    );
    const snapshot = this.snapshots.get(uri);
    if (
      !document ||
      !snapshot ||
      snapshot.id !== snapshotId ||
      document.version !== snapshot.version ||
      fix.range[1] > document.getText().length
    )
      return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(fix.range[0]),
        document.positionAt(fix.range[1]),
      ),
      fix.text,
    );
    await vscode.workspace.applyEdit(edit);
  }
  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeAction[]> {
    if (
      !this.supported(document) ||
      !this.config(document).get("lint.enable", true)
    )
      return [];
    if (context.only?.contains(fixAllKind)) {
      const edits = await this.fixedEdits(document, token);
      if (!edits.length) return [];
      const action = new vscode.CodeAction("Fix all Bun problems", fixAllKind);
      action.edit = new vscode.WorkspaceEdit();
      action.edit.set(document.uri, edits);
      return [action];
    }
    const snapshot = this.snapshots.get(document.uri.toString());
    if (!snapshot || snapshot.version !== document.version) return [];
    return snapshot.entries
      .filter(
        (entry) =>
          entry.fix &&
          context.diagnostics.some(
            (diagnostic) =>
              diagnostic.source === "Bun" &&
              diagnostic.message === entry.diagnostic.message &&
              diagnostic.range.isEqual(entry.diagnostic.range),
          ),
      )
      .map((entry) => {
        const action = new vscode.CodeAction(
          `Bun: Fix ${String(entry.diagnostic.code ?? "problem")}`,
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [entry.diagnostic];
        action.isPreferred = true;
        action.command = {
          command: "bunTools.applyFix",
          title: action.title,
          arguments: [document.uri.toString(), snapshot.id, entry.fix],
        };
        return action;
      });
  }
  publishWorkspace(
    reports: LintFile[],
    root: vscode.WorkspaceFolder,
    versions: Map<string, number>,
  ) {
    for (const report of reports) {
      const uri = vscode.Uri.file(report.filePath);
      if (
        vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !==
          root.uri.toString() ||
        !lintFile(report.filePath)
      )
        continue;
      const document = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === uri.toString(),
      );
      if (document) {
        if (
          !document.isDirty &&
          document.version === versions.get(uri.toString())
        )
          this.publish(document, report.messages);
      } else {
        this.diagnostics.set(
          uri,
          report.messages.map((message) => {
            const diagnostic = new vscode.Diagnostic(
              new vscode.Range(
                message.line - 1,
                message.column - 1,
                (message.endLine ?? message.line) - 1,
                (message.endColumn ?? message.column + 1) - 1,
              ),
              message.message,
              message.severity === 2
                ? vscode.DiagnosticSeverity.Error
                : vscode.DiagnosticSeverity.Warning,
            );
            diagnostic.source = "Bun";
            if (message.ruleId) diagnostic.code = message.ruleId;
            return diagnostic;
          }),
        );
      }
    }
  }
  clearWorkspace(folder: vscode.WorkspaceFolder) {
    this.diagnostics.forEach((uri) => {
      if (
        !vscode.workspace.textDocuments.some(
          (document) =>
            document.uri.toString() === uri.toString() && document.isDirty,
        ) &&
        vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ===
          folder.uri.toString()
      )
        this.diagnostics.delete(uri);
    });
  }
  configurationVersion(folder: vscode.WorkspaceFolder): number {
    return this.rootVersions.get(folder.uri.toString()) ?? this.globalVersion;
  }
  refresh(folder?: vscode.WorkspaceFolder) {
    const affected = (uri: vscode.Uri) =>
      !folder ||
      vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ===
        folder.uri.toString();
    if (folder)
      this.rootVersions.set(folder.uri.toString(), ++this.refreshSerial);
    else {
      this.globalVersion = ++this.refreshSerial;
      this.rootVersions.clear();
      this.scheduler.dispose();
    }
    const documents = vscode.workspace.textDocuments.filter((document) =>
      affected(document.uri),
    );
    const open = new Set(documents.map((document) => document.uri.toString()));
    let closed = 0;
    this.diagnostics.forEach((uri, diagnostics) => {
      if (!affected(uri)) return;
      if (diagnostics.length && !open.has(uri.toString())) closed++;
      this.diagnostics.delete(uri);
    });
    for (const key of this.snapshots.keys())
      if (affected(vscode.Uri.parse(key))) this.snapshots.delete(key);
    for (const document of documents) this.schedule(document, "open");
    if (closed)
      this.info(
        `Cleared Bun diagnostics for ${closed} closed file(s) in ${folder?.name ?? "all workspaces"}. Run Bun Tools: Lint Workspace to refresh closed files.`,
      );
  }
  dispose() {
    this.scheduler.dispose();
    this.diagnostics.dispose();
    this.snapshots.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
