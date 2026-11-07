import * as vscode from "vscode";
import path from "node:path";
import os from "node:os";
import { Discovery } from "../bun/discovery";
import { Formatter, languages, minimalEdit, djangoHtml } from "./core";

export class FormattingProvider
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider
{
  private pending = new Map<string, AbortController>();
  constructor(
    private readonly discovery: Discovery,
    private readonly formatter: Formatter,
    private readonly error: (message: string) => void,
  ) {}

  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ) {
    return this.provide(document, token);
  }
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ) {
    return this.provide(document, token, range);
  }
  private async provide(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
    range?: vscode.Range,
  ): Promise<vscode.TextEdit[]> {
    if (
      !vscode.workspace.isTrusted ||
      !languages[document.languageId] ||
      token.isCancellationRequested
    )
      return [];
    const config = vscode.workspace.getConfiguration("bunTools", document.uri);
    if (!config.get("format.enable", true)) return [];
    const source = document.getText(),
      version = document.version;
    if (document.languageId === "html" && /{%|{{/.test(source)) return [];
    const key = document.uri.toString();
    this.pending.get(key)?.abort();
    const controller = new AbortController();
    this.pending.set(key, controller);
    const cancellation = token.onCancellationRequested(() =>
      controller.abort(),
    );
    try {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri
        .fsPath;
      const hasSourcePath =
        document.uri.scheme === "file" ||
        document.uri.scheme === "vscode-userdata";
      const cwd =
        folder ??
        (hasSourcePath ? path.dirname(document.uri.fsPath) : os.homedir());
      const runtime = await this.discovery.get({
        folder,
        explicit: config.get<string>("bunPath"),
      });
      controller.signal.throwIfAborted();
      const file = hasSourcePath
        ? document.uri.fsPath
        : path.join(cwd, `untitled${languages[document.languageId]}`);
      if (djangoHtml(file, source)) return [];
      const output = await this.formatter.format(
        runtime,
        cwd,
        file,
        source,
        controller.signal,
        range
          ? {
              start: document.offsetAt(range.start),
              end: document.offsetAt(range.end),
            }
          : undefined,
        document.languageId === "jsonc" ? "jsonc" : undefined,
      );
      if (
        controller.signal.aborted ||
        document.isClosed ||
        document.version !== version
      )
        return [];
      const edit = minimalEdit(source, output);
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
        this.error(`Formatting failed: ${String(error)}`);
      return [];
    } finally {
      cancellation.dispose();
      if (this.pending.get(key) === controller) this.pending.delete(key);
    }
  }
  cancel(uri: vscode.Uri): void {
    this.pending.get(uri.toString())?.abort();
  }
  dispose(): void {
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
  }
}
