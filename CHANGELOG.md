# Changelog

## Unreleased

## 0.2.3 — 2026-11-09

### Fixed

- Limit local configuration diagnostic resets to the affected workspace root and explain closed-file
  rechecks.
- Explain skipped HTML templates in debug output and documentation.
- Explain how to restart runtime discovery after installing Bun.

### Security

- Isolate TOML parsing from preload scripts in the temporary directory.

## 0.2.2 — 2026-11-08

- Add section-aware global Bun configuration with per-file and multi-root resolution.
- Report selected formatter and linter configuration in Runtime Info.
- Add automatic release versioning and Marketplace packaging metadata.

## 0.1.0 — 2026-11-07

- Native Bun formatting, diagnostics, safe fixes and workspace commands.
- Automatic runtime discovery, cancellation and multi-root support.
- User settings formatting, language status and extension icon.
