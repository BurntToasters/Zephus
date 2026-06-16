# Zephus
A WYSIWYG Local GUI web editor; edit your git-hosted sites!

Zephus is currently in the early stages of development.

## License

Zephus is free software released under the [GNU General Public License v3.0](./LICENSE).

The desktop application bundles third-party open-source software:

- **Electron, Chromium, and Node.js** — redistributed under their respective
  licenses (notices ship alongside the application binary).
- **Bundled libraries** (CodeMirror, Lucide, and others) — see the in-app
  **About → Third-Party Licenses** view, generated into `licenses.json` from the
  packages compiled into the app, including those inlined into the renderer
  bundle.

All bundled dependencies use permissive licenses (MIT, ISC, BSD-style, Python-2.0,
BlueOak-1.0.0, WTFPL) that are compatible with GPL-3.0. Each project supplies its
own Astro install; Zephus does not bundle or redistribute Astro.
