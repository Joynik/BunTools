# Technical research — 2026-11-07

Research preceded implementation. The installed Bun changed during development: initial stable
`1.4.4+38afee6c8` supported formatting but had no native lint command. After the user's runtime
update, `bun --revision` reported `1.4.4-canary.1+7ca0042d3`, with native lint support. The
extension probes capabilities at runtime and does not hard-code this difference.

## Primary sources

- [Bun 1.4.4 release](https://bun.com/blog/bun-v1.4.4).
- [Bun formatter documentation](https://bun.com/docs/format).
- [Bun linter documentation](https://bun.com/docs/lint).
- [VS Code programmatic language features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).
- [VS Code API](https://code.visualstudio.com/api/references/vscode-api).
- [VS Code Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust).
- [Official Bun extension manifest](https://github.com/oven-sh/bun/blob/main/packages/bun-vscode/package.json),
  fetched directly from raw.githubusercontent.com. Inspected version: `0.0.31`.

VS Code formatting registration and minimal-edit guidance were also checked through Context7 against
`/websites/code_visualstudio_api`. API declarations are pinned at `1.96.0` to match the declared
minimum editor version.

## Formatter findings

| Probe | Observed result | Consequence |
| --- | --- | --- |
| `bun fmt --help --all` | stdin path, no-script, range, doctor, check and list flags exist | Enable features only after checking required flags |
| `bun fmt --no-script --stdin-filepath /absolute/path.ts` | Formats stdin to stdout without changing disk | Unsaved editor formatting works |
| Invalid TypeScript through stdin | Exit 2 with syntax error | Return no editor edits |
| `[fmt] semi=false, singleQuote=true` | Output follows project settings | Let Bun find configuration |
| `.editorconfig` with four spaces and CRLF | Requested indentation and line endings | Do not duplicate formatting settings |
| JavaScript/TypeScript range after emoji | UTF-16 offsets select the correct statement | Use VS Code offsets directly |
| `--doctor --format=json` | Structured file/plugin inventory | Reject external formatter delegation |
| `--list-files .` | Eligible paths follow `.gitignore` | Enumerate using Bun, then filter supported extensions |
| `--check` on unformatted files | Exit 1 and no writes | Report differences without treating them as a CLI crash |
| Project defines `fmt` script | `--no-script` uses native formatter | Always bypass package-script dispatch |

Fourteen requested language IDs have real fixture tests. Selection formatting is restricted to
verified JS/TS IDs. HTML template markers `{{` and `{%` are conservatively excluded; Markdown and
TOML are not registered.

## Linter findings on canary revision 7ca0042d3

| Probe | Observed result | Consequence |
| --- | --- | --- |
| `bun --help` | Advertises native `lint` | Permit isolated lint capability probes |
| `bun lint --no-script --help --all` | JSON, stdin filename, fix-dry-run, fix, type-aware and doctor flags exist | Use native contracts only |
| JSON lint through stdin | ESLint-shaped array with `filePath`, `messages`, counts | Parse structured output, never terminal text |
| Multiple problems | Multiple messages with rule IDs and severity 1/2 | Warning/Error diagnostics with source `Bun` |
| Emoji before a problem | Columns and fix ranges use UTF-16, not UTF-8 bytes | Direct conversion to VS Code positions |
| Invalid code | Exit 1 with structured fatal parse diagnostic | Publish parser errors without changing source |
| `--fix-dry-run` | JSON `output` contains safely fixed code, disk unchanged | Current file fixes, source.fixAll and opt-in save fixes |
| JSON `messages[].fix` | UTF-16 `[start,end]` and replacement text | Quick Fix with snapshot/version protection |
| Relative import in stdin, original path | Existing import resolves; missing import reports `import/no-unresolved` | Unsaved current-file analysis preserves import base |
| `--type-aware` | Reports `@typescript-eslint/no-floating-promises` | Expose native type-aware option |
| `--fix` on saved files | Writes safe fixes and respects `.gitignore` | Explicit Fix Workspace |
| `--doctor --format=json` | `files.by_eslint` and `rules.javascript` identify delegation | Refuse external engines and JavaScript rule plugins |
| Project defines `lint` script | `--no-script` bypasses it | Never dispatch project scripts |
| Workspace JSON paths on macOS | Canonical `/private/var/...` paths can differ from VS Code's `/var/...` | Normalize to the selected workspace path spelling |

The verified JSON contract emits Error and Warning only. No Information/Hint data exists to map.
Dangerous fixes and suggestions are not requested. Cross-file imports and types use disk contents of
other files; only the current document is passed through stdin.

## Runtime probes

Executable candidates are checked using `--version`, `--help` and `--revision` in an isolated
temporary directory. Native lint support additionally requires advertised flags and a real
JSON/stdin smoke test. Safe-fix capability requires a real dry-run response containing fixed output.
Unknown contracts stay disabled. A missing command never probes project scripts.

## VS Code integration

Document and range format providers return edits; VS Code owns Format Document With and Format on
Save. The linter uses a diagnostic collection, per-URI debounce, cancellation and version guards.
Quick Fix commands also carry a unique diagnostic snapshot ID, so a closed/reopened file cannot
reuse a stale fix. Config changes refresh automatic diagnostics; manual mode remains manual.

Current-file fixes use WorkspaceEdit and do not save the editor. Workspace fixes are explicit native
CLI writes and refuse dirty editors. Source fix-all uses `source.fixAll.bun`. The separate opt-in
save participant is subject to VS Code's save time budget.

## Official extension coexistence

The inspected official manifest contributes running, debugging, test integration, runtime socket
diagnostics, tasks and lockfile viewing. It does not contribute a native formatting provider. Bun
Tools uses separate `bunTools.*` names and a `Bun` diagnostic collection. It does not duplicate
those other services. This is a manifest-level assessment; a joint official-extension UI session is
not claimed.
