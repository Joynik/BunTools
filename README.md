# Bun Formatter & Linter

A lightweight VS Code extension that runs your installed **Bun executable**. No bundled formatter,
linter, WebAssembly engine, language server, or production dependencies.

**Native formatting, lint diagnostics and safe fixes run directly through your installed Bun.**
Formatting was verified with Bun 1.4.4. Linting and fixes were verified with revision
`1.4.4-canary.1+7ca0042d3`. The original stable 1.4.4 binary lacked native lint; unsupported
binaries retain formatting and show a clear lint capability limitation. Capabilities are probed
instead of inferred from a version number.

## Install locally

1. Install Bun 1.4.4 or newer yourself: <https://bun.com/docs/installation>.
2. Open VS Code and run **Extensions: Install from VSIX…**.
3. Select `bun-tools-0.1.0.vsix`.
4. Trust your project when appropriate.
5. Run **Format Document With… → Bun Formatter & Linter**.
6. Optionally select **Configure Default Formatter…** and enable `editor.formatOnSave`.

The extension never changes your default formatter automatically. It does not install or update Bun.

```text
Editor text → Bun discovery → bun fmt stdin → VS Code text edit
                         └→ bun lint JSON → Problems / Quick Fix
                                  ↑
                         project configuration
```

## Settings example

```jsonc
{
  "editor.defaultFormatter": "buntools-local.bun-tools",
  "editor.formatOnSave": true,
  "bunTools.bunPath": "",
  "bunTools.format.enable": true,
  "bunTools.lint.enable": true,
  "bunTools.lint.run": "onType",
  "bunTools.lint.debounce": 400,
  "bunTools.lint.fixOnSave": false,
  "bunTools.lint.typeAware": false,
  "bunTools.output.logLevel": "info"
}
```

Use language-specific settings if other formatters should remain the default:

```jsonc
{
  "[typescript][javascript][typescriptreact][javascriptreact]": {
    "editor.defaultFormatter": "buntools-local.bun-tools",
    "editor.formatOnSave": true
  }
}
```

An empty `bunTools.bunPath` enables automatic discovery. An explicit path is authoritative: an
invalid explicit path reports an error instead of silently selecting a different Bun. Relative
explicit paths resolve against the corresponding workspace folder. `~/` is supported.
Environment-variable and shell-expression expansion are intentionally not performed.

Discovery checks workspace `node_modules/.bin/bun`, `node_modules/bun/bin/bun`, `.bun/bin/bun`,
absolute PATH entries, standard installer and Homebrew locations, Windows WinGet/Scoop locations,
then `BUN_INSTALL/bin`. Windows uses `bun.exe` and does not execute `.cmd` wrappers. Symlinks
resolve to their executable targets. PATH-based version managers work when their executable or
symlink is present in the VS Code process environment. Other layouts can use an explicit path. macOS
Homebrew and `~/.bun/bin` work even when Finder provides a reduced PATH.

Each workspace folder has its own runtime cache and resource-scoped settings. **Bun Tools: Restart**
clears the cache, including failures. Changing Bun Tools settings or workspace folders also clears
it. After installing or switching Bun outside VS Code, run Restart.

## Formatting

Default document languages: JavaScript, JSX, TypeScript, TSX, HTML, CSS, SCSS, Less, Vue, JSON,
JSONC, JSON5, GraphQL and YAML. The relevant syntax extension must register language IDs such as
`vue` and `json5` in VS Code. Bun Tools does not install syntax extensions.

Markdown, TOML, Django HTML and other languages have no Bun Tools document provider. HTML containing
`{{` or `{%` is conservatively skipped to protect Django templates. This also skips other HTML
template languages using those markers. Vue is supported separately.

Document formatting passes current editor text, including unsaved changes, to
`bun fmt --no-script --stdin-filepath <absolute-path>`. It returns a text edit and never writes the
source file. Common unchanged prefix and suffix are retained to reduce cursor movement. Unicode and
CRLF edit boundaries are preserved. Bun owns output line endings; configure `end_of_line` or
`endOfLine` in the project.

Untitled documents use a synthetic filename under the user's home directory. They have no real
project path; save them into a project to apply that project's configuration.

Selection formatting is offered for verified JavaScript/TypeScript language IDs when Bun advertises
range flags. Bun may expand a selection to complete syntax statements. Other languages support
Format Document.

Syntax errors return no edits. New requests cancel older requests for the same document. Edits are
discarded when document versions change. VS Code cancellation kills Bun. Two child processes may run
concurrently; requests beyond this limit wait in a cancellable queue. Document operations time out
after 15 seconds; discovery probes after 5 seconds.

## Project configuration

Bun resolves `bunfig.toml`, `.editorconfig`, supported formatter configuration and nested overrides
itself. The extension runs from the matching workspace folder and passes the real source path. It
neither creates nor parses project formatter settings into VS Code settings.

Example `bunfig.toml`:

```toml
[fmt]
printWidth = 100
semi = false
singleQuote = true
ignorePatterns = ["vendor/", "**/*.gen.ts"]
```

Without a workspace folder, saved documents use their parent directory. Configuration changes are
read by the next Bun process; no filesystem polling is used. Save configuration buffers before
formatting.

Before formatting or linting, Bun’s JSON doctor report inspects selected paths and configuration. If
Bun reports delegation to an external formatter, ESLint or JavaScript rule plugins, the operation
stops. Unsupported third-party languages are excluded from workspace operations. Project
configuration can execute code in Bun, so Workspace Trust is required.

## Commands

| Command | Behavior |
| --- | --- |
| Bun Tools: Format Workspace | Rewrites supported saved files using native Bun |
| Bun Tools: Check Formatting | Checks saved files without writing; reports whether formatting is needed |
| Bun Tools: Lint Workspace | Checks saved files and publishes Problems diagnostics |
| Bun Tools: Fix Current File | Applies native safe fixes to current editor text without saving it |
| Bun Tools: Fix Workspace | Applies native safe fixes to saved project files |
| Bun Tools: Restart | Cancels child processes and clears discovery cache |
| Bun Tools: Show Runtime Info | Shows resolved executable, version and capability details |
| Bun Tools: Show Output | Opens the Bun Tools output channel |

Multi-root project commands ask which folder to use. Workspace formatting enumerates paths using
Bun's `--list-files`, preserving Bun's ignore logic. It then selects the supported extensions and
skips template HTML and symlinks outside the project. Operations run in batches of 30 paths, with
progress and cancellation. Workspace formatting refuses to start with dirty documents. Check
Formatting reports that it checks saved files when editors are dirty.

Cancellation is not a transaction: completed batches remain on disk. A syntax or configuration error
can also leave earlier workspace batches completed. Use version control to review explicit workspace
edits. Neither check nor runtime information commands change source files.

## Linting and fixes

JavaScript, JSX, TypeScript and TSX receive diagnostics from
`bun lint --no-script --format=json --stdin --stdin-filename <absolute-path>`. Tests verify that
relative imports resolve from that path without writing unsaved text to disk. Bun supplies rule IDs,
messages, severities, UTF-16 coordinates and safe fix ranges. Supported severities in the verified
Bun JSON contract are Error and Warning; Bun does not currently emit Information or Hint.

- `onType` checks opening, editing after 400 ms by default, and saving.
- `onSave` checks opening and saving. Changes clear obsolete diagnostics immediately.
- `manual` checks only through Lint Workspace.

A URI-specific scheduler aborts obsolete requests. Results must match the current document version.
Closing a document clears diagnostics and pending requests. Saving known project configuration files
or changing lint settings refreshes diagnostics. Configuration watchers monitor configuration names
and do not poll source files.

Quick Fix uses Bun's safe `fix` payload. **Fix Current File** and **source.fixAll.bun** use
`--fix-dry-run` to obtain fixed text. They apply editor edits without overwriting saved files. Stale
results and stale Quick Fix commands are rejected. Suggestions and dangerous fixes are never
requested.

Example standard VS Code save action, independent of `lint.fixOnSave`:

```jsonc
{
  "editor.codeActionsOnSave": {
    "source.fixAll.bun": "explicit"
  }
}
```

Alternatively, set `bunTools.lint.fixOnSave` to `true`. This uses VS Code's save participant and
remains subject to VS Code's save-participant time budget. Slow operations can be skipped by VS
Code; use Fix Current File explicitly in that case. Keep one fix-on-save method enabled to avoid
duplicate work. Formatting on save continues to use the standard formatter mechanism.

`lint.typeAware` enables Bun's `--type-aware`; the extension does not bundle TypeScript or another
analysis runtime. The Bun process can read imported files from disk, so unsaved changes in other
documents are not overlaid. Save related files for fully consistent cross-file type and import
analysis.

Workspace lint checks saved files. Workspace fixes refuse to start with dirty editors and stop when
new dirty changes appear. Workspace commands have progress, cancellation and a 120-second CLI
timeout. Completed disk changes remain on cancellation. Bun's native ignore and configuration rules
apply. Diagnostics for dirty editors are kept separate from saved-file workspace results.

Older Bun versions without a verified JSON/stdin lint contract receive no fabricated diagnostics.
Show Runtime Info reports the exact revision, capabilities and reason. Discovery runs JSON and
dry-run smoke probes outside the project. Missing lint never dispatches a project's package script.

See [technical research](docs/RESEARCH.md) and [verification coverage](docs/TESTING.md).

## Security and compatibility

The extension is disabled in untrusted and virtual workspaces. Processes use `spawn` without a
shell. Every formatter and linter call uses `--no-script` to bypass package-script dispatch.
Discovery probes run in an isolated temporary directory. No binaries, plugins or engines are
downloaded at runtime. Runtime injection variables `BUN_OPTIONS` and `NODE_OPTIONS` are removed from
child environments. Formatting data stays local. Logs omit source excerpts.

The official `oven.bun-vscode` extension can provide debugging, running and testing independently.
Bun Tools uses only the `bunTools.*` command and setting namespace. It does not register a debugger,
runtime diagnostics socket, test controller, task provider or lockfile editor. No extension
dependency is required.

## Develop and package

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run test:host
bun run package
```

`bun run test` runs unit tests and real-Bun integration tests. It requires a supported Bun on PATH
or in standard locations. `bun run test:host` uses installed VS Code on macOS; elsewhere
`@vscode/test-electron` downloads a test build. Set `VSCODE_EXECUTABLE_PATH` to choose another
executable. Linux CI needs a display, for example `xvfb-run bun run test:host`.

For interactive debugging, open this directory in VS Code and press **F5**. The launch configuration
runs the build task and starts Extension Development Host. Open a separate test project there.

Packaging emits `bun-tools-0.1.0.vsix`. The `buntools-local` publisher is a local placeholder.
Before Marketplace publication, choose an owned publisher ID, update settings examples and tests,
add real repository metadata, and review the tested Bun revision and compatibility limits. No
publication is performed by this project.
