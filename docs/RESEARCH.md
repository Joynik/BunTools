# Native Bun contracts

- Probe CLI capabilities instead of relying on the Bun version number.
- Use UTF-16 fix positions and native safe fixes. Use `--fix-dry-run` for editor buffers and `--fix`
  for explicit workspace writes.
- Pass global configuration before the subcommand: `bun --config=<path> fmt` or `lint`. The
  separate-argument form returned empty output in the tested binary.
- Detect TOML sections with `Bun.TOML.parse`.
