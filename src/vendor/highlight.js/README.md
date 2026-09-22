# highlight.js 11.12.0

This directory vendors the unmodified browser ES module with common languages.
It is loaded from the local server when the source reader first opens; the
browser does not contact a CDN. No npm installation is required.

- Project: https://github.com/highlightjs/highlight.js
- Distribution: https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.12.0/build/es/highlight.min.js
- License source: https://github.com/highlightjs/highlight.js/blob/11.12.0/LICENSE
- License: BSD-3-Clause; see [LICENSE](LICENSE).
- `highlight.min.js` SHA-256: `1ed8fc5256b738b8875b74e4d3f0754f60d6411fb034d618dfbc4e6e6c9999d7`

To update, replace the module and license from the same pinned upstream release,
record its version and SHA-256 here, and run the source reader tests. Do not
format or patch the vendored module; keep integration changes in `source-view.mjs`.
