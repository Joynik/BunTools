# Publishing

1. Use publisher ID `kira` and display name **Kira** in
   [Marketplace management](https://marketplace.visualstudio.com/manage).
2. Follow [BUILD.md](../BUILD.md), run host tests and prepare the release.
3. Install and review the generated VSIX.
4. Upload the VSIX in Marketplace management, or authenticate `vsce` and run
   `bun run publish:marketplace`.

```text
Prepare → Verify → Review VSIX → Publish
```

Release preparation does not commit, tag, push or publish.
