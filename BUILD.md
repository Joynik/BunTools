# Build and verification

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:host
bun run package
```

```text
Install → Check → Test → Verify in VS Code → Package
```

Install `bun-tools-<version>.vsix` through **Extensions: Install from VSIX…**. Press **F5** to
debug. Host tests use isolated projects and profiles. Set `VSCODE_EXECUTABLE_PATH` to select VS
Code. Runtime verification covers macOS; Windows and Linux discovery have unit coverage only.

## Release

`package.json` is the version source. Add notes under `## Unreleased` in `CHANGELOG.md`. Run
`bun run release` for patch changes or `bun run release minor` for features. Use `major` only with
explicit user authorization. Append `--dry-run` to preview the version. The command runs type checks
and tests, increments the version, updates the changelog and builds the VSIX. Ordinary builds and
packaging do not increment the version.

[Publication](docs/PUBLISHING.md) requires an explicit action.
