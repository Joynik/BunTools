# Bun Formatter & Linter

Native Bun formatting, lint diagnostics and safe fixes for VS Code. Requires Bun 1.4.4 or newer with
the relevant CLI features. Bun is detected automatically; no extra engine is installed.

## Setup

1. Install the extension and trust your project.
2. Select **Bun Formatter & Linter** through **Format Document With…**.
3. Enable formatting on save if needed:

```jsonc
{
  "editor.defaultFormatter": "kira.bun-tools",
  "editor.formatOnSave": true,
  "bunTools.globalConfigPath": "~/.config/bun/bunfig.toml"
}
```

Formatting supports JS/JSX, TS/TSX, HTML, CSS, SCSS, Less, Vue, JSON/JSONC/JSON5, GraphQL and YAML.
User `settings.json` is supported. Markdown, TOML and Django HTML are excluded.

## Configuration

For each file, formatting and linting select their own section:

1. Nearest project `bunfig.toml` containing `[fmt]` or `[lint]`.
2. The matching section in the global file.
3. Bun defaults and its normal configuration discovery.

```text
Local section → Global section → Bun defaults
```

Local configurations use native Bun discovery. Global configurations use `bun --config=<path>`.
Files are never merged or copied. Change `bunTools.globalConfigPath` to use another file; an empty
value disables the global fallback. Multi-root projects resolve independently.

## Controls

- `bunTools.bunPath`: optional executable path.
- `bunTools.format.enable`: enable formatting.
- `bunTools.lint.enable`: enable diagnostics.
- `bunTools.lint.run`: `onType`, `onSave` or `manual`.
- `bunTools.lint.debounce`: typing delay; default 400 ms.
- `bunTools.lint.fixOnSave`: safe fixes on save; default off.
- `bunTools.lint.typeAware`: native type-aware rules; default off.

Command Palette: **Format Workspace**, **Check Formatting**, **Lint Workspace**,
**Fix Current File**, **Fix Workspace**, **Restart**, **Show Runtime Info**, **Show Output**, under
**Bun Tools**.

Quick Fix and `source.fixAll.bun` use native safe fixes. Workspace commands operate on saved files.
Workspace writes refuse dirty editors; cancellation leaves completed edits in place. Imported files
are read from disk. Unsupported Bun capabilities are reported without fallback engines.

The `{}` language status menu shows Bun status. **Show Runtime Info** includes the selected
configuration sources.

[Publishing](docs/PUBLISHING.md) · [Build and testing](BUILD.md) · MIT License
