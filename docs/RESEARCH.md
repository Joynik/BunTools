# Native CLI contracts

Bun 1.4.4 provides stdin formatting, JSON lint output, UTF-16 positions and native safe fixes when
these features are present. The extension checks capabilities rather than assuming support from the
version number.

- Formatting: `fmt --no-script --stdin-filepath`, range flags and JSON doctor reports.
- Lint: `lint --no-script --format=json --stdin --stdin-filename`.
- Fixes: JSON fix ranges, `--fix-dry-run` for editor text, `--fix` for explicit workspace changes.
- Global Bun TOML: `bun --config=<path> fmt` / `lint`. The separate-argument root flag produced
  empty output in the tested binary; the equals form works.
- Section detection uses native `Bun.TOML.parse` without configuration merging or generated files.

Sources: [Bun config](https://bun.com/docs/runtime/bunfig),
[formatter](https://bun.com/docs/format), [linter](https://bun.com/docs/lint),
[VS Code API](https://code.visualstudio.com/api/references/vscode-api).
