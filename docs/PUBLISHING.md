# Publishing

1. In [Marketplace publisher management](https://marketplace.visualstudio.com/manage), use publisher
   ID `kira` and display name **Kira**. Display names belong to the account, not `package.json`.
2. Add concise notes under `## Unreleased` in `CHANGELOG.md`.
3. Run `bun run test:host`, then `bun run release`. Use `minor` or `major` for those version
   increments.
4. Install and review the generated VSIX. Release updates the package version and changelog
   automatically; ordinary builds do not.
5. When ready, upload the VSIX in Marketplace management. Alternatively, authenticate `vsce` and
   explicitly run `bun run publish:marketplace`.

No script commits, pushes, tags or publishes automatically. Keep credentials out of the repository.
Verify publisher ownership and the public repository before the first publication.
