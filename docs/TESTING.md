# Testing

- `bun run typecheck`: TypeScript validation.
- `bun run test`: unit tests and real Bun formatting, linting, fixes and configuration precedence.
- `bun run test:host`: actual VS Code behavior using isolated temporary projects and profile.
- `bun run package`: builds the installable VSIX.
- `bun run release --dry-run`: previews the next release number without modifying files.

Tests cover document edits, save actions, diagnostics, cancellation, Unicode, multi-root, user
settings and native configuration selection. Host tests use installed VS Code on macOS;
`VSCODE_EXECUTABLE_PATH` can select another executable. Linux CI needs a display such as Xvfb.

Runtime execution is verified on macOS. Windows/Linux discovery has unit coverage; their editor
runtime and joint operation with the official Bun extension are not verified.
