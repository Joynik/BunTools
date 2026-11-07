# Build

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:host
bun run package
```

Install the resulting `bun-tools-<version>.vsix` through **Extensions: Install from VSIX…**. Press
**F5** to debug. For a new version, use `bun run release` (`patch` by default), or specify `minor` /
`major`.
