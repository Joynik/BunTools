# Verification coverage

## Commands

```sh
bun run typecheck
bun run test
bun run test:host
bun run package
```

The complete tests require a Bun with native formatting, JSON/stdin linting and safe dry-run fixes.
They deliberately fail instead of silently skipping real integration checks. Verified lint runtime:
`1.4.4-canary.1+7ca0042d3`; formatting was also verified on original stable 1.4.4.

## Coverage map

| Requirement | Evidence | Limit |
| --- | --- | --- |
| macOS/Linux/Windows discovery order | Platform candidate unit tests, quoted Windows PATH | Actual execution verified on macOS only |
| Homebrew, spaces, symlinks and cache | Real Bun discovery tests | Other manager layouts use PATH or explicit paths |
| Fourteen formatting languages | Real fixtures, idempotence, no disk writes | Syntax extensions may be required for non-built-in VS Code languages |
| Unsaved content and Format on Save | Real stdin and VS Code host tests | Untitled documents have no real project path |
| Selection and Unicode/CRLF | Real Bun range tests and minimal-edit reconstruction | Selection limited to JS/TS IDs |
| Missing Bun, CLI failures, timeout, cancellation | Runner/discovery tests, running and queued cancellation | Remote and Windows runtimes not exercised |
| Native JSON diagnostics | Real lint tests for multiple messages, Unicode ranges and parse errors | Verified Bun emits Error/Warning only |
| Open, typing, save and close | VS Code host tests | Editor runtime uses temporary profile |
| Debounce and stale results | Scheduler tests and host typing/version checks | No cross-file unsaved overlay |
| Relative imports and types | Real stdin import test and type-aware rule test | Other imported documents are read from disk |
| Quick Fix, source.fixAll and current-file fix | VS Code host tests plus dry-run integration tests | No dangerous fixes or suggestions |
| Opt-in fixOnSave | VS Code host test | VS Code enforces its save-participant time budget |
| Workspace check, format, lint and fix | Real CLI and VS Code command tests | Completed writes remain on cancellation |
| Native engine guard | Malformed/delegated doctor response tests; real plugin inspection | Config code runs only in trusted workspaces |
| Markdown/TOML/Django exclusion | Selector, filename and host tests | Conservative HTML markers may skip other template dialects |
| Multi-root/configuration reload | Host projects with separate bunfig files | Folder selection remains interactive when more than one root exists |
| Official Bun extension | Manifest inspection and namespace tests | Joint runtime compatibility is not verified |
| Workspace Trust | Manifest declaration and process guards | Restricted Mode UI session is not automated |

## Host isolation

`scripts/test-host.ts` creates two temporary projects, a temporary `.code-workspace`, a separate
user profile and an empty extensions directory. It clears `ELECTRON_RUN_AS_NODE` for the child
editor. It removes temporary projects after the editor exits. User settings and extensions are not
changed.

Use `VSCODE_EXECUTABLE_PATH` to select another editor executable. macOS GUI launches can require
permission outside a filesystem sandbox. Linux CI needs a display such as Xvfb.
