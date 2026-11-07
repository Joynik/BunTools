import * as vscode from "vscode";
import type { Discovery } from "./bun/discovery";

/** Contributes to VS Code's built-in {} language status menu. */
export class BunLanguageStatus {
  readonly item: vscode.LanguageStatusItem;
  private subscriptions: vscode.Disposable[];
  private generation = 0;
  private disposed = false;
  constructor(
    private discovery: Discovery,
    private selector: vscode.DocumentSelector,
    private extensionId: string,
  ) {
    this.item = vscode.languages.createLanguageStatusItem(
      "bunTools.status",
      selector,
    );
    this.item.name = "Bun Tools";
    this.item.text = "Bun Formatter & Linter";
    this.item.command = {
      command: "bunTools.showRuntimeInfo",
      title: "Show Bun Runtime Info",
    };
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(() => {
        void this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("bunTools") ||
          event.affectsConfiguration("editor.defaultFormatter")
        )
          void this.refresh();
      }),
    ];
    void this.refresh();
  }
  async refresh() {
    const generation = ++this.generation;
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !vscode.languages.match(this.selector, document)) return;
    this.item.busy = true;
    this.item.severity = vscode.LanguageStatusSeverity.Information;
    this.item.detail = "Discovering Bun…";
    const config = vscode.workspace.getConfiguration("bunTools", document.uri);
    const selected =
      vscode.workspace
        .getConfiguration("editor", {
          uri: document.uri,
          languageId: document.languageId,
        })
        .get<string>("defaultFormatter") === this.extensionId;
    try {
      const runtime = await this.discovery.get({
        folder: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
        explicit: config.get<string>("bunPath"),
      });
      if (this.disposed || generation !== this.generation) return;
      const formatting =
        config.get("format.enable", true) && runtime.format
          ? selected
            ? "Default formatter"
            : "Formatter available"
          : "Formatting disabled";
      const lint =
        runtime.lint && config.get("lint.enable", true)
          ? `Lint: ${config.get<string>("lint.run", "onType")}`
          : "Lint unavailable or disabled";
      this.item.detail = `${formatting} · Bun ${runtime.version} · ${lint}`;
      if (!runtime.format && !runtime.lint)
        this.item.severity = vscode.LanguageStatusSeverity.Warning;
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.item.severity = vscode.LanguageStatusSeverity.Warning;
      this.item.detail = String(error);
    } finally {
      if (!this.disposed && generation === this.generation)
        this.item.busy = false;
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.item.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
