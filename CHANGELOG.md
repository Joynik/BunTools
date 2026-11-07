# Changelog

## 0.1.0 — 2026-11-07

- Add the official Bun mascot with a wrench badge as the VS Code extension icon.

- Discover installed Bun per workspace, including Homebrew, PATH, official installer and explicit paths.
- Format current saved or unsaved documents through native Bun stdin and standard VS Code formatting APIs.
- Format selected JavaScript/TypeScript statements with native Bun range flags.
- Add cancellable workspace formatting and read-only formatting checks.
- Add runtime capability reporting, isolated discovery probes, process limits, timeouts and restart.
- Add native JSON lint diagnostics with debounce, cancellation, document version guards, onType/onSave/manual modes and type-aware rules.
- Add native Quick Fix, source.fixAll.bun, dry-run fixes for unsaved buffers, opt-in fixes on save and workspace lint/fix commands.
- Probe capabilities at runtime. Lint and fixes verified with Bun 1.4.4-canary.1+7ca0042d3; older binaries keep supported formatting features.
- Add automated unit, real-Bun integration and VS Code host tests.
