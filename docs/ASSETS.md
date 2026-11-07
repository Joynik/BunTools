# Extension icon

- `assets/bun-original.svg` is the unmodified official color logo from <https://bun.com/logo.svg>,
  downloaded on 2026-11-07.
- Official source and brand information: <https://bun.com/press-kit>.
- `assets/icon.svg` preserves that logo geometry and colors and adds a separate pink wrench badge
  for Bun Tools.
- `assets/icon.png` is its transparent 256 × 256 PNG render, produced with resvg 2.6.2.

The extension manifest points to `assets/icon.png`. The VSIX includes the PNG and this attribution.
The editable SVGs remain in the project. The renderer is a build-time asset tool and is not an
extension dependency.

Bun's name and logo belong to their respective owners. Bun Tools is an independent extension, not an
official Bun product. The MIT license for this project's code does not grant ownership of the Bun
mark.
